import {
  GatewayCloseCodes,
  GatewayDispatchEvents,
  GatewayIntentBits,
  GatewayOpcodes,
  type GatewayMessageCreateDispatchData,
  type GatewayReceivePayload,
  type GatewaySendPayload,
} from "discord-api-types/v10";

// A minimal client for Discord's Gateway: the WebSocket connection over which Discord sends a bot
// events, such as every new message in the servers it's in. Interactions arrive over HTTP and
// don't need it; only inline verses do. It runs inside a Durable Object (durable-object.ts),
// which supplies the socket, storage and alarm, so this file has no Cloudflare-specific code.
//
// The protocol (https://discord.com/developers/docs/events/gateway):
//   1. Connect. Discord sends Hello with a heartbeat interval (about 41 seconds).
//   2. Send Identify (a new session) or Resume (pick up a dropped session, and Discord replays
//      the events missed since the last sequence number).
//   3. Send a heartbeat every interval. If Discord doesn't acknowledge one before the next is
//      due, the connection is dead ("zombied"): close it and resume.
//   4. When the connection drops, or Discord asks (Reconnect, Invalid Session), reconnect,
//      resuming when possible: Discord allows only 1,000 Identifies a day per bot.
//
// All timing runs on the Durable Object's single alarm, through tick(): it sends heartbeats,
// notices dead connections, and reconnects after a delay. An alarm survives the object being
// restarted (on every deploy), so a fresh copy wakes up, finds no socket, and resumes the session
// saved in storage. The connection only runs while some server has inline verses on.

const GATEWAY_URL = "wss://gateway.discord.gg";
const GATEWAY_QUERY = "?v=10&encoding=json";

/** New messages in servers, with their text (Message Content is a privileged intent; see CLAUDE.md). */
export const GATEWAY_INTENTS = GatewayIntentBits.GuildMessages | GatewayIntentBits.MessageContent;

/** How long to wait for Hello after connecting before giving up on the connection. */
const CONNECT_TIMEOUT_MS = 30_000;
/** Reconnect delays double after each failed attempt, up to this. Success resets them. */
const MAX_RETRY_MS = 2 * 60_000;
/**
 * After a close that retrying won't fix (bad token, intents not enabled in the Developer Portal),
 * wait this long before trying again, rather than burning through the day's Identifies.
 */
const FATAL_RETRY_MS = 15 * 60_000;

/** Closes that mean the bot is misconfigured, with the fix, for the logs. */
const FATAL_CLOSES: Partial<Record<number, string>> = {
  [GatewayCloseCodes.AuthenticationFailed]: "the bot token is wrong. Check DISCORD_TOKEN.",
  [GatewayCloseCodes.InvalidShard]: "invalid shard.",
  [GatewayCloseCodes.ShardingRequired]: "the bot is in too many servers for one connection; it needs sharding.",
  [GatewayCloseCodes.InvalidAPIVersion]: "invalid API version.",
  [GatewayCloseCodes.InvalidIntents]: "invalid intents.",
  [GatewayCloseCodes.DisallowedIntents]:
    "the Message Content intent isn't enabled. Turn it on in the Developer Portal → Bot → Privileged Gateway Intents.",
};

/** Closes after which the session can't be resumed, so the next connection identifies afresh. */
const SESSION_ENDING_CLOSES = new Set<number>([GatewayCloseCodes.InvalidSeq, GatewayCloseCodes.SessionTimedOut]);

/**
 * Closing with 1000 or 1001 ends the session on Discord's side; any other code (we use 4000) keeps
 * it resumable.
 */
const CLOSE_AND_END_SESSION = 1000;
const CLOSE_AND_KEEP_SESSION = 4000;

/** The parts of a WebSocket the client uses (a Cloudflare WebSocket in production, a fake in tests). */
export interface GatewaySocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: (event: { code: number; reason: string }) => void): void;
  addEventListener(type: "error", listener: (event: unknown) => void): void;
}

/** The parts of Durable Object storage the client uses: a few saved values and the alarm. */
export interface GatewayStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}

export interface GatewayClientOptions {
  token: string;
  storage: GatewayStorage;
  /** Opens a WebSocket to `url`. */
  openSocket: (url: string) => Promise<GatewaySocket>;
  /**
   * Whether the connection should run: true while any server has inline verses on. Asked once, then
   * again only after wake().
   */
  shouldRun: () => Promise<boolean>;
  /** Handles a new message. Resolves true if it replied, so the client remembers not to reply again. */
  onMessage: (message: GatewayMessageCreateDispatchData) => Promise<boolean>;
  now?: () => number;
  random?: () => number;
}

/**
 * A session that can be resumed: its ID, the URL to resume at, the number of the last event fully
 * handled, and the messages answered most recently.
 */
interface SavedSession {
  id: string;
  resumeUrl: string;
  seq: number | null;
  /** IDs of the last REMEMBERED_REPLIES messages replied to, so a replayed one isn't answered twice. */
  replied?: string[];
}

const REMEMBERED_REPLIES = 50;

const SESSION_KEY = "session";
const RETRY_AT_KEY = "retryAt";

export class GatewayClient {
  private socket?: GatewaySocket;
  private connectStartedAt = 0;
  private heartbeatInterval?: number;
  private nextHeartbeatAt = 0;
  private awaitingAck = false;
  private session?: SavedSession;
  private seq: number | null = null;
  private savedSeq: number | null = null;
  private loaded = false;
  private failures = 0;
  /** When the next connection attempt is allowed (0: now). */
  private retryAt = 0;
  /** Whether any server has inline verses on; undefined until asked (again, after wake()). */
  private running?: boolean;
  /** Numbers of the message events still being handled (their replies may not have gone out). */
  private readonly inProgress = new Set<number>();

  private readonly now: () => number;
  private readonly random: () => number;

  constructor(private readonly options: GatewayClientOptions) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  /**
   * Called when the object is woken from outside (a server turned inline verses on or off, or the
   * cron): the next tick asks again whether the connection should run. Heartbeat ticks don't, since
   * the answer only changes when /setinlineverses runs, and that wakes the object.
   */
  wake(): void {
    this.running = undefined;
  }

  /** Called by the alarm. */
  async tick(): Promise<void> {
    await this.load();

    this.running ??= await this.options.shouldRun();
    if (!this.running) {
      await this.stop();
      return;
    }

    const now = this.now();
    if (!this.socket) {
      // Woken while waiting to retry (the cron runs every few minutes): keep waiting.
      if (now < this.retryAt) return this.options.storage.setAlarm(this.retryAt);
      await this.connect();
      return;
    }

    if (this.heartbeatInterval === undefined) {
      // Connected, still waiting for Hello. Woken early (e.g. by /setinlineverses): keep waiting.
      const deadline = this.connectStartedAt + CONNECT_TIMEOUT_MS;
      if (now < deadline) return this.options.storage.setAlarm(deadline);
      return this.reconnect("Discord didn't say Hello");
    }

    if (now < this.nextHeartbeatAt) {
      // Woken before the next heartbeat is due; don't send one early.
      return this.options.storage.setAlarm(this.nextHeartbeatAt);
    }
    if (this.awaitingAck) return this.reconnect("Discord didn't acknowledge the last heartbeat");

    this.heartbeat();
    await this.saveProgress();
    this.nextHeartbeatAt = now + this.heartbeatInterval;
    await this.options.storage.setAlarm(this.nextHeartbeatAt);
  }

  /** Loads the saved session the first time it's needed (a fresh object starts with nothing in memory). */
  private async load(): Promise<void> {
    if (this.loaded) return;
    this.session = await this.options.storage.get<SavedSession>(SESSION_KEY);
    this.seq = this.savedSeq = this.session?.seq ?? null;
    this.retryAt = (await this.options.storage.get<number>(RETRY_AT_KEY)) ?? 0;
    this.loaded = true;
  }

  private async connect(): Promise<void> {
    const url = (this.session?.resumeUrl ?? GATEWAY_URL) + GATEWAY_QUERY;
    this.connectStartedAt = this.now();
    let socket: GatewaySocket;
    try {
      socket = await this.options.openSocket(url);
    } catch (error) {
      console.error("[gateway] Couldn't connect:", error);
      return this.retryLater();
    }

    this.socket = socket;
    this.heartbeatInterval = undefined;
    this.awaitingAck = false;
    // Events from a socket we've replaced are ignored.
    socket.addEventListener("message", (event) => {
      if (socket === this.socket) this.receive(event.data).catch((error) => console.error("[gateway] Error handling event:", error));
    });
    socket.addEventListener("close", (event) => {
      if (socket === this.socket) this.closed(event.code, event.reason).catch((error) => console.error("[gateway] Error after close:", error));
    });
    socket.addEventListener("error", (event) => console.warn("[gateway] Socket error:", event));
    await this.options.storage.setAlarm(this.connectStartedAt + CONNECT_TIMEOUT_MS);
  }

  private async receive(data: unknown): Promise<void> {
    if (typeof data !== "string") return; // we never ask for compressed (binary) payloads
    const payload = JSON.parse(data) as GatewayReceivePayload;
    if (payload.op === GatewayOpcodes.Dispatch) this.seq = payload.s;

    switch (payload.op) {
      case GatewayOpcodes.Hello: {
        this.heartbeatInterval = payload.d.heartbeat_interval;
        if (this.session) {
          this.send({ op: GatewayOpcodes.Resume, d: { token: this.options.token, session_id: this.session.id, seq: this.seq ?? 0 } });
        } else {
          this.send({
            op: GatewayOpcodes.Identify,
            d: {
              token: this.options.token,
              intents: GATEWAY_INTENTS,
              properties: { os: "cloudflare", browser: "sb-discord-app", device: "sb-discord-app" },
            },
          });
        }
        // Discord asks for the first heartbeat at a random point in the first interval.
        this.nextHeartbeatAt = this.now() + Math.floor(this.heartbeatInterval * this.random());
        await this.options.storage.setAlarm(this.nextHeartbeatAt);
        return;
      }
      case GatewayOpcodes.Heartbeat:
        this.heartbeat();
        return;
      case GatewayOpcodes.HeartbeatAck:
        this.awaitingAck = false;
        return;
      case GatewayOpcodes.Reconnect:
        return this.reconnect("Discord asked to reconnect", 0);
      case GatewayOpcodes.InvalidSession:
        // d says whether the session can still be resumed. Discord asks for a 1-5 second wait.
        if (!payload.d) await this.forgetSession();
        return this.reconnect("Discord said the session is invalid", 1000 + Math.floor(this.random() * 4000));
      case GatewayOpcodes.Dispatch:
        return this.dispatch(payload);
    }
  }

  private async dispatch(payload: Extract<GatewayReceivePayload, { op: GatewayOpcodes.Dispatch }>): Promise<void> {
    switch (payload.t) {
      case GatewayDispatchEvents.Ready:
        this.session = { id: payload.d.session_id, resumeUrl: payload.d.resume_gateway_url, seq: this.seq };
        await this.options.storage.put(SESSION_KEY, this.session);
        this.savedSeq = this.seq;
        return this.connected(`Connected as ${payload.d.user.username} in ${payload.d.guilds.length} server(s)`);
      case GatewayDispatchEvents.Resumed:
        return this.connected("Resumed the session");
      case GatewayDispatchEvents.MessageCreate:
        return this.handleMessage(payload.s, payload.d);
    }
  }

  /**
   * Passes a message to the handler. While it's being handled, saved progress stops just before it,
   * so a restart replays it rather than losing it. Messages answered are remembered, so a replayed
   * one isn't answered twice.
   */
  private async handleMessage(seq: number, message: GatewayMessageCreateDispatchData): Promise<void> {
    if (this.session?.replied?.includes(message.id)) return;
    this.inProgress.add(seq);
    let replied = false;
    try {
      replied = await this.options.onMessage(message);
    } finally {
      this.inProgress.delete(seq);
    }
    if (replied && this.session) {
      this.session = { ...this.session, replied: [...(this.session.replied ?? []), message.id].slice(-REMEMBERED_REPLIES) };
      await this.saveProgress({ force: true });
    }
  }

  private async connected(message: string): Promise<void> {
    this.failures = 0;
    console.log(`[gateway] ${message}`);
    await this.clearRetry();
  }

  private async closed(code: number, reason: string): Promise<void> {
    this.socket = undefined;
    this.heartbeatInterval = undefined;

    const fatal = FATAL_CLOSES[code];
    if (fatal) {
      console.error(`[gateway] Discord closed the connection (${code}): ${fatal} Trying again in ${FATAL_RETRY_MS / 60_000} minutes.`);
      await this.forgetSession();
      await this.retryLater(FATAL_RETRY_MS);
      return;
    }

    console.warn(`[gateway] Connection closed (${code}${reason ? `: ${reason}` : ""})`);
    if (SESSION_ENDING_CLOSES.has(code)) await this.forgetSession();
    await this.retryLater();
  }

  /** Drops the current connection (keeping the session resumable) and connects again after `delay`. */
  private async reconnect(reason: string, delay?: number): Promise<void> {
    console.warn(`[gateway] Reconnecting: ${reason}`);
    const socket = this.socket;
    this.socket = undefined;
    this.heartbeatInterval = undefined;
    socket?.close(CLOSE_AND_KEEP_SESSION, reason);
    await this.retryLater(delay);
  }

  /** Disconnects and ends the session: no server wants inline verses any more. */
  private async stop(): Promise<void> {
    if (this.socket) {
      console.log("[gateway] No server has inline verses on; disconnecting.");
      const socket = this.socket;
      this.socket = undefined;
      this.heartbeatInterval = undefined;
      socket.close(CLOSE_AND_END_SESSION, "No server has inline verses on");
    }
    await this.forgetSession();
    // Any wait before retrying stays: turning inline verses off and on again mustn't skip the
    // 15 minutes after a misconfiguration and use up the day's sessions.
    await this.options.storage.deleteAlarm();
  }

  /**
   * Connects again after `delay`, or after a wait that doubles with each failure. The time is saved,
   * so a restarted object (or a wake-up from the cron) waits too, instead of retrying at once.
   */
  private async retryLater(delay?: number): Promise<void> {
    const wait = delay ?? Math.min(1000 * 2 ** this.failures, MAX_RETRY_MS);
    this.failures++;
    this.retryAt = this.now() + wait;
    await this.options.storage.put(RETRY_AT_KEY, this.retryAt);
    await this.options.storage.setAlarm(this.retryAt);
  }

  private async clearRetry(): Promise<void> {
    if (this.retryAt === 0) return;
    this.retryAt = 0;
    await this.options.storage.delete(RETRY_AT_KEY);
  }

  private heartbeat(): void {
    this.send({ op: GatewayOpcodes.Heartbeat, d: this.seq });
    this.awaitingAck = true;
  }

  private send(payload: GatewaySendPayload): void {
    this.socket?.send(JSON.stringify(payload));
  }

  /**
   * Saves how far events have been handled, so a restarted object resumes from there: the latest
   * event, or just before the oldest message still being handled. Never goes backwards. Skipped if
   * nothing changed, unless `force` (the list of replied messages changed).
   */
  private async saveProgress({ force = false }: { force?: boolean } = {}): Promise<void> {
    if (!this.session) return;
    const handled = this.inProgress.size > 0 ? Math.min(...this.inProgress) - 1 : this.seq;
    const seq = handled !== null && (this.savedSeq === null || handled > this.savedSeq) ? handled : this.savedSeq;
    if (seq === this.savedSeq && !force) return;
    this.session = { ...this.session, seq };
    this.savedSeq = seq;
    await this.options.storage.put(SESSION_KEY, this.session);
  }

  private async forgetSession(): Promise<void> {
    if (!this.session && this.seq === null) return;
    this.session = undefined;
    this.seq = this.savedSeq = null;
    await this.options.storage.delete(SESSION_KEY);
  }
}
