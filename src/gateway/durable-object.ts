import { replyToReferences } from "../inline/messages.js";
import { useDatabase } from "../storage/database.js";
import { anyInlineVersesEnabled } from "../storage/guild-settings.js";
import { parseEnv, type Env } from "../utils/config.js";
import { GatewayClient, type GatewaySocket, type GatewayStorage } from "./client.js";

// The Durable Object that holds the bot's one Gateway connection (wrangler.jsonc: binding
// GATEWAY, class Gateway). A Durable Object is a single long-lived instance that Cloudflare keeps
// running while it has work, unlike the Worker, which stops after each request. The Worker talks
// to it through control.ts. All the protocol logic is in client.ts.

/** The parts of Cloudflare's DurableObjectState used here. */
interface DurableObjectStateLike {
  storage: GatewayStorage;
}

/** A Cloudflare WebSocket: a standard WebSocket that must be accept()ed before use. */
interface WorkerWebSocket extends GatewaySocket {
  accept(): void;
}

export class Gateway {
  private client?: GatewayClient;

  constructor(
    private readonly state: DurableObjectStateLike,
    private readonly env: unknown,
  ) {}

  /**
   * Requests from the Worker (control.ts). POST /wake runs the alarm now, rechecking whether any
   * server has inline verses on.
   */
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === "POST" && pathname === "/wake") {
      this.client?.wake();
      await this.state.storage.setAlarm(Date.now());
      return new Response(null, { status: 204 });
    }
    return new Response("Not found", { status: 404 });
  }

  /** Cloudflare calls this when the alarm the client set goes off. */
  async alarm(): Promise<void> {
    const client = this.getClient();
    if (client) await client.tick();
  }

  private getClient(): GatewayClient | undefined {
    if (this.client) return this.client;

    const env: Env = parseEnv(this.env);
    useDatabase(env.DB);
    const token = env.DISCORD_TOKEN;
    if (!token) {
      console.error("[gateway] DISCORD_TOKEN is missing, so inline verses can't connect. Set it with `pnpm wrangler secret put DISCORD_TOKEN`.");
      return undefined;
    }

    this.client = new GatewayClient({
      token,
      storage: this.state.storage,
      openSocket,
      shouldRun: anyInlineVersesEnabled,
      onMessage: async (message) => {
        try {
          return await replyToReferences(message, token);
        } catch (error) {
          console.error(`[inline] Couldn't reply to message ${message.id}:`, error);
          return false;
        }
      },
    });
    return this.client;
  }
}

/** Opens an outgoing WebSocket the Cloudflare way: a fetch with an Upgrade header. */
async function openSocket(url: string): Promise<GatewaySocket> {
  const response = await fetch(url.replace(/^wss:/, "https:"), { headers: { Upgrade: "websocket" } });
  const socket = (response as Response & { webSocket?: WorkerWebSocket | null }).webSocket;
  if (!socket) throw new Error(`Discord didn't accept the WebSocket (HTTP ${response.status})`);
  socket.accept();
  return socket;
}
