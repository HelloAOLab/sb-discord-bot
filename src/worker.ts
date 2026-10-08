import { createApp } from "./server/app.js";

// Cloudflare Workers entry point (wrangler.jsonc "main"). Cloudflare calls fetch(request, env, ctx)
// for every request; the Hono app routes it.
export default createApp();
