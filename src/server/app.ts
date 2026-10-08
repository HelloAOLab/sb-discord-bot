import { Hono, type Context } from "hono";
import { verifyKey } from "discord-interactions";
import type { APIInteraction } from "discord-api-types/v10";
import { runDeferredWork } from "../interactions/deferred.js";
import { handleInteraction } from "../interactions/router.js";
import { useDatabase } from "../storage/database.js";
import { parseEnv, type Env } from "../utils/config.js";

type AppContext = Context<{ Bindings: Env }>;

/** The HTTP app. src/worker.ts hands it every request Cloudflare receives. */
export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/", (c) => c.json({ name: "sb-discord-app", status: "running" }));
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Discord POSTs every interaction here (Developer Portal → Interactions Endpoint URL).
  app.post("/interactions", async (c) => {
    const env = parseEnv(c.env);
    useDatabase(env.DB);

    // Discord signs each request; the signature covers the exact bytes it sent, so verify the raw
    // body before parsing it. Discord rejects an endpoint that accepts unsigned requests.
    const body = await c.req.text();
    const signature = c.req.header("X-Signature-Ed25519");
    const timestamp = c.req.header("X-Signature-Timestamp");
    if (!signature || !timestamp || !(await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY))) {
      return c.json({ error: "Bad request signature" }, 401);
    }

    const response = await handleInteraction(JSON.parse(body) as APIInteraction);
    if (!response) return c.json({ error: "Unsupported interaction type" }, 400);

    const work = runDeferredWork(response);
    if (work) keepRunning(c, work);
    return c.json(response);
  });

  app.notFound((c) => c.json({ error: "Not found" }, 404));
  app.onError((error, c) => {
    console.error("[server] Unhandled error:", error);
    return c.json({ error: "Internal server error" }, 500);
  });

  return app;
}

/**
 * Lets `work` (a deferred reply's follow-up) finish after the response is sent. A Worker is
 * stopped once it responds unless it's told to wait with waitUntil().
 */
function keepRunning(c: AppContext, work: Promise<void>): void {
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    // No execution context outside Cloudflare (e.g. tests): the promise simply runs on.
  }
}
