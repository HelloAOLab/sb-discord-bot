import { z } from "zod";
import { registerCommands } from "./discord-app.js";

// Registers every command in `commandList` with Discord. Runs on your machine with Node
// (`pnpm deploy-commands`), not on Cloudflare, so it reads DISCORD_TOKEN and DISCORD_CLIENT_ID
// from .env. Global commands can take up to an hour to show up in Discord after registering.

try {
  process.loadEnvFile(".env");
} catch {
  // No .env file: the variables may be set in the shell instead.
}

const env = z
  .object({
    DISCORD_TOKEN: z.string({ error: "DISCORD_TOKEN is missing from .env" }).min(1),
    DISCORD_CLIENT_ID: z.string({ error: "DISCORD_CLIENT_ID is missing from .env" }).min(1),
  })
  .safeParse(process.env);

if (!env.success) {
  for (const issue of env.error.issues) console.error(`  - ${issue.message}`);
  process.exitCode = 1;
} else {
  console.log("Registering commands...");
  try {
    const count = await registerCommands(env.data.DISCORD_TOKEN, env.data.DISCORD_CLIENT_ID);
    console.log(`Done: ${count} command(s).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
