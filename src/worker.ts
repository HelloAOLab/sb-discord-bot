import { useGateway, wakeGateway } from "./gateway/control.js";
import { createApp } from "./server/app.js";
import { parseEnv } from "./utils/config.js";

// Cloudflare Workers entry point (wrangler.jsonc "main"). Cloudflare calls fetch(request, env, ctx)
// for every request; the Hono app routes it. scheduled() runs on the cron in wrangler.jsonc.

const app = createApp();

export default {
  fetch: app.fetch,

  /**
   * Every few minutes, wake the Gateway object so it reconnects if its alarm chain ever broke.
   * Normally its own alarm keeps it running and this changes nothing.
   */
  scheduled(_controller: unknown, env: unknown, ctx: { waitUntil(promise: Promise<unknown>): void }): void {
    useGateway(parseEnv(env).GATEWAY);
    ctx.waitUntil(wakeGateway().catch((error) => console.error("[gateway] Scheduled wake failed:", error)));
  },
};

// Durable Object classes must be exported from the entry point.
export { Gateway } from "./gateway/durable-object.js";
