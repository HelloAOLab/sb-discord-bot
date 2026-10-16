import { useGateway, wakeGateway } from "./gateway/control.js";
import { createApp } from "./server/app.js";
import { runDueSessions } from "./sessions/scheduler.js";
import { useDatabase } from "./storage/database.js";
import { parseEnv } from "./utils/config.js";

// Cloudflare Workers entry point (wrangler.jsonc "main"). Cloudflare calls fetch(request, env, ctx)
// for every request; the Hono app routes it. scheduled() runs on the cron in wrangler.jsonc.

const app = createApp();

/** How often (in minutes) the cron wakes the Gateway object. */
const GATEWAY_WAKE_MINUTES = 5;

export default {
  fetch: app.fetch,

  /**
   * Every minute: send reading sessions' reminders and start messages that are due. Every few
   * minutes, also wake the Gateway object so it reconnects if its alarm chain ever broke (normally
   * its own alarm keeps it running and this changes nothing).
   */
  scheduled(controller: { scheduledTime: number }, env: unknown, ctx: { waitUntil(promise: Promise<unknown>): void }): void {
    const { DB, GATEWAY, DISCORD_TOKEN } = parseEnv(env);
    useDatabase(DB);
    useGateway(GATEWAY);
    ctx.waitUntil(runDueSessions(DISCORD_TOKEN).catch((error) => console.error("[sessions] Scheduled run failed:", error)));
    if (new Date(controller.scheduledTime).getUTCMinutes() % GATEWAY_WAKE_MINUTES === 0) {
      ctx.waitUntil(wakeGateway().catch((error) => console.error("[gateway] Scheduled wake failed:", error)));
    }
  },
};

// Durable Object classes must be exported from the entry point.
export { Gateway } from "./gateway/durable-object.js";
