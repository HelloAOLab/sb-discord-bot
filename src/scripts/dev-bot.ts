import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { z } from "zod";
import { currentApplication, discordApi, registerCommands, setInstallSettings, setInteractionsEndpoint } from "./discord-app.js";
import { BOT_PERMISSIONS, INSTALL_SCOPES, guildInstallConfig, inviteUrl } from "./install.js";
import { findTunnelUrl, isDevEndpoint } from "./tunnel.js";

// `pnpm dev:bot`: runs your dev bot against your local code, in one command.
//
//   1. sets the dev application's install settings: the scopes and permissions in install.ts
//   2. applies migrations/ to the local database
//   3. starts the Worker (`wrangler dev`) on http://localhost:8787, with the dev bot's settings
//   4. opens a Cloudflare quick tunnel to it (a random https://….trycloudflare.com address)
//   5. sets the dev application's Interactions Endpoint URL to <tunnel>/interactions
//   6. registers the slash commands: in DISCORD_DEV_GUILD_ID's server if set (instant), else globally
//
// Then it keeps running, showing the Worker's logs, until Ctrl+C.
//
// The dev bot is a separate Discord application with its own settings in .env.dev (copy
// .env.dev.example), under the same names as in .env. Only .env.dev is used, here and by the local
// Worker (`wrangler dev --env-file .env.dev`), so the deployed bot's values in .env are never
// touched. As a safeguard, it refuses to change an application whose endpoint isn't a tunnel, or
// the same application as .env's; `--force` skips the endpoint check.
// Needs cloudflared: `winget install --id Cloudflare.cloudflared`.

const ENV_FILE = ".env.dev";
const PORT = 8787;
const LOCAL_URL = `http://localhost:${PORT}`;
const isWindows = process.platform === "win32";

const children: ChildProcess[] = [];
let stopping = false;

const envSchema = z.object({
  DISCORD_TOKEN: z.string({ error: `DISCORD_TOKEN is missing from ${ENV_FILE}` }).min(1),
  DISCORD_CLIENT_ID: z.string({ error: `DISCORD_CLIENT_ID is missing from ${ENV_FILE}` }).min(1),
  DISCORD_PUBLIC_KEY: z.string({ error: `DISCORD_PUBLIC_KEY is missing from ${ENV_FILE} (the local Worker needs it)` }).min(1),
  // Blank counts as not set.
  DISCORD_DEV_GUILD_ID: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().regex(/^\d+$/, "DISCORD_DEV_GUILD_ID must be a server ID (digits only), or left blank").optional(),
  ),
});
type DevEnv = z.infer<typeof envSchema>;

const devFile = readEnvFile(ENV_FILE);
const parsed = devFile ? envSchema.safeParse(devFile) : undefined;

if (!parsed) {
  console.error(`✘ ${ENV_FILE} not found. Copy .env.dev.example to ${ENV_FILE} and fill in your dev bot's values.`);
  process.exitCode = 1;
} else if (!parsed.success) {
  for (const issue of parsed.error.issues) console.error(`  - ${issue.message}`);
  process.exitCode = 1;
} else if (readEnvFile(".env")?.DISCORD_CLIENT_ID === parsed.data.DISCORD_CLIENT_ID) {
  console.error(`✘ ${ENV_FILE} and .env name the same application (${parsed.data.DISCORD_CLIENT_ID}). The dev bot must be a separate application.`);
  process.exitCode = 1;
} else {
  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));
  try {
    await run(parsed.data, process.argv.includes("--force"));
  } catch (error) {
    // After Ctrl+C, whatever was still waiting fails quietly.
    if (!stopping) {
      console.error(`\n✘ ${error instanceof Error ? error.message : error}`);
      stop(1);
    }
  }
}

async function run(env: DevEnv, force: boolean): Promise<void> {
  if (spawnSync("cloudflared", ["--version"], { stdio: "ignore" }).error) {
    throw new Error("cloudflared isn't installed. Install it with `winget install --id Cloudflare.cloudflared`, then open a new terminal.");
  }

  step("Checking the Discord application");
  const app = await currentApplication(env.DISCORD_TOKEN);
  if (app.id !== env.DISCORD_CLIENT_ID) {
    throw new Error(`DISCORD_TOKEN belongs to application ${app.id} ("${app.name}"), but DISCORD_CLIENT_ID is ${env.DISCORD_CLIENT_ID}. Check ${ENV_FILE}.`);
  }
  if (!force && !isDevEndpoint(app.interactions_endpoint_url)) {
    throw new Error(
      `"${app.name}" uses ${app.interactions_endpoint_url}, which isn't a dev tunnel: this looks like the deployed bot. ` +
        `Put a separate dev application's values in ${ENV_FILE}, or run with --force if this really is your dev bot.`,
    );
  }
  console.log(`  ${app.name} (${app.id})`);

  step("Updating the install settings");
  await setInstallSettings(env.DISCORD_TOKEN, guildInstallConfig(app));
  console.log(`  Scopes: ${INSTALL_SCOPES.join(", ")}`);
  console.log(`  Permissions: ${Object.keys(BOT_PERMISSIONS).join(", ")}`);
  if (app.custom_install_url) {
    console.log(`  Note: the app's install link is a custom URL (${app.custom_install_url}), which ignores these settings.`);
  }

  step("Applying migrations to the local database");
  // stdin is closed, so wrangler doesn't wait for a "continue?" answer.
  const migrate = spawnSync("pnpm wrangler d1 migrations apply DB --local", { stdio: ["ignore", "inherit", "inherit"], shell: true });
  if (migrate.status !== 0) throw new Error("Applying the migrations failed (see above).");

  step(`Starting the Worker on ${LOCAL_URL}`);
  // Only .env.dev: the local Worker must check the dev bot's signatures and post as the dev bot.
  const worker = start("dev", `pnpm wrangler dev --port ${PORT} --env-file ${ENV_FILE}`);
  pipeLines(worker, (line) => console.log(`[dev] ${line}`));
  await waitFor(`${LOCAL_URL}/health`, 90_000, "The Worker didn't start (see the [dev] lines above).");

  step("Opening a Cloudflare tunnel");
  const tunnel = start("tunnel", `cloudflared tunnel --no-autoupdate --url ${LOCAL_URL}`);
  const tunnelUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("cloudflared didn't print a tunnel address within 60 seconds.")), 60_000);
    timer.unref(); // so it doesn't keep the script running after Ctrl+C
    // cloudflared logs to stderr; only its errors are worth showing.
    pipeLines(tunnel, (line) => {
      const url = findTunnelUrl(line);
      if (url) {
        clearTimeout(timer);
        resolve(url);
      }
      if (/\bERR\b/.test(line)) console.log(`[tunnel] ${line}`);
    });
  });
  console.log(`  ${tunnelUrl}`);
  // The address takes a few seconds to start working.
  await waitFor(`${tunnelUrl}/health`, 90_000, "The tunnel address never started working.");

  step("Setting the Interactions Endpoint URL");
  const endpoint = `${tunnelUrl}/interactions`;
  // Discord checks the URL by sending it a PING; give the tunnel a few tries.
  await retry(() => setInteractionsEndpoint(env.DISCORD_TOKEN, endpoint), 4, 3000);
  console.log(`  ${endpoint}`);

  step(env.DISCORD_DEV_GUILD_ID ? `Registering commands in server ${env.DISCORD_DEV_GUILD_ID}` : "Registering commands globally");
  const count = await registerCommands(env.DISCORD_TOKEN, env.DISCORD_CLIENT_ID, env.DISCORD_DEV_GUILD_ID);
  console.log(`  ${count} command(s)`);
  if (env.DISCORD_DEV_GUILD_ID) {
    const global = await discordApi<unknown[]>(env.DISCORD_TOKEN, "GET", `/applications/${env.DISCORD_CLIENT_ID}/commands`);
    if (global.length > 0) {
      console.log(`  Note: this app also has ${global.length} global command(s), so your server may list each command twice.`);
    }
  } else {
    console.log(`  Global commands can take up to an hour to appear. Set DISCORD_DEV_GUILD_ID in ${ENV_FILE} to see them at once in your dev server.`);
  }

  console.log(`\n✔ "${app.name}" now runs your local code. Press Ctrl+C to stop.`);
  console.log(`  Add the bot to a server, or update its permissions where it already is:\n    ${inviteUrl(env.DISCORD_CLIENT_ID, env.DISCORD_DEV_GUILD_ID)}`);
  console.log("  The cron (session reminders and start messages) runs every minute, as on Cloudflare.\n");
  runCronEveryMinute();
}

/**
 * `wrangler dev` doesn't run the cron in wrangler.jsonc by itself, so scheduled sessions would
 * never start locally. This asks it to, at the start of every minute, like Cloudflare does.
 */
function runCronEveryMinute(): void {
  const runCron = async () => {
    try {
      const response = await fetch(`${LOCAL_URL}/cdn-cgi/local/scheduled`, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) console.log(`[cron] Running the cron failed: ${response.status} ${await response.text()}`);
    } catch (error) {
      if (!stopping) console.log(`[cron] Running the cron failed: ${error instanceof Error ? error.message : error}`);
    }
  };
  // Line up with the start of the next minute, then repeat.
  const timer = setTimeout(() => {
    void runCron();
    setInterval(runCron, 60_000).unref();
  }, 60_000 - (Date.now() % 60_000));
  timer.unref();
}

/**
 * Starts a long-running command, through the shell so `pnpm` is found on Windows (the command
 * lines are fixed in this file, never user input). If it exits on its own, everything stops.
 */
function start(name: string, commandLine: string): ChildProcess {
  const child = spawn(commandLine, { stdio: ["ignore", "pipe", "pipe"], shell: true });
  children.push(child);
  child.on("exit", (code) => {
    // On Windows, Ctrl+C reaches the child processes too, sometimes before our own handler runs.
    setTimeout(() => {
      if (stopping) return;
      console.error(`\n✘ ${name} stopped (exit code ${code}).`);
      stop(1);
    }, 250);
  });
  return child;
}

/** Calls `onLine` with each line the process prints, on stdout or stderr. */
function pipeLines(child: ChildProcess, onLine: (line: string) => void): void {
  for (const stream of [child.stdout, child.stderr]) {
    let buffered = "";
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk: string) => {
      const lines = (buffered + chunk).split(/\r?\n/);
      buffered = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) onLine(line);
    });
  }
}

/** Waits until `url` answers 200, checking every second. */
async function waitFor(url: string, timeoutMs: number, failure: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !stopping) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await sleep(1000);
  }
  throw new Error(failure);
}

async function retry(attempt: () => Promise<void>, tries: number, delayMs: number): Promise<void> {
  for (let i = 1; ; i++) {
    if (stopping) throw new Error("Stopped.");
    try {
      return await attempt();
    } catch (error) {
      if (i >= tries) throw error;
      await sleep(delayMs);
    }
  }
}

/**
 * Stops the Worker and the tunnel. On Windows, `pnpm` runs wrangler in a separate process tree,
 * which kill() wouldn't reach, so the whole tree is ended with taskkill. Sets the exit code rather
 * than calling process.exit(), which can crash Node on Windows while sockets are closing.
 */
function stop(code: number): void {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (child.exitCode !== null || child.pid === undefined) continue;
    if (isWindows) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
  if (children.length > 0) console.log("\nStopped. (The dev bot's endpoint still points at the closed tunnel until the next `pnpm dev:bot`.)");
}

/** The variables in an env file, without adding them to process.env; null if there's no such file. */
function readEnvFile(path: string): Record<string, string> | null {
  if (!existsSync(path)) return null;
  return parseEnv(readFileSync(path, "utf8")) as Record<string, string>;
}

function step(text: string): void {
  console.log(`\n→ ${text}`);
}

// A function declaration, not a const: the main code above runs before this line is reached.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
