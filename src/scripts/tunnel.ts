// Helpers for `pnpm dev:bot` (dev-bot.ts), which exposes the local Worker to Discord through a
// Cloudflare quick tunnel: `cloudflared tunnel --url http://localhost:8787` prints a random
// https://<words>.trycloudflare.com address that forwards to it, with no Cloudflare account.

const TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/** The tunnel's public address if this piece of cloudflared's output announces it. */
export function findTunnelUrl(output: string): string | undefined {
  return TUNNEL_URL.exec(output)?.[0];
}

/**
 * Whether an Interactions Endpoint URL is one this script set (a quick tunnel), or empty. Anything
 * else (a workers.dev address, a custom domain) suggests .env holds the deployed bot's token, whose
 * endpoint must not be pointed at a laptop.
 */
export function isDevEndpoint(url: string | null | undefined): boolean {
  if (!url) return true;
  try {
    return new URL(url).hostname.endsWith(".trycloudflare.com");
  } catch {
    return false;
  }
}
