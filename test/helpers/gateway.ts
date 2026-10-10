import { MessageType, type GatewayMessageCreateDispatchData, type GatewayReceivePayload } from "discord-api-types/v10";
import type { GatewaySocket, GatewayStorage } from "../../src/gateway/client.js";

// Stand-ins for what the Gateway connection deals with: a new message as Discord sends it, a
// WebSocket the test drives by hand, and Durable Object storage with its alarm.

/** The guild_id test messages are posted in (the same as the interaction helpers use). */
export const TEST_GUILD = "300000000000000001";

/** A MESSAGE_CREATE event's data: a member's message in a server. */
export function gatewayMessage(
  content: string,
  overrides: Partial<GatewayMessageCreateDispatchData> = {},
): GatewayMessageCreateDispatchData {
  return {
    id: "700000000000000001",
    channel_id: "400000000000000001",
    guild_id: TEST_GUILD,
    author: { id: "100000000000000001", username: "tester", global_name: "Tester", discriminator: "0", avatar: null },
    content,
    timestamp: "2026-01-01T00:00:00.000Z",
    edited_timestamp: null,
    tts: false,
    mention_everyone: false,
    mentions: [],
    mention_roles: [],
    attachments: [],
    embeds: [],
    pinned: false,
    type: MessageType.Default,
    ...overrides,
  } as GatewayMessageCreateDispatchData;
}

/** A WebSocket whose sent frames are recorded and whose incoming events the test triggers. */
export class FakeSocket implements GatewaySocket {
  sent: any[] = [];
  closedWith?: { code?: number; reason?: string };
  private listeners: Record<string, ((event: any) => void)[]> = {};

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  /** Delivers a payload from Discord, then lets the client's async handling finish. */
  async receive(payload: GatewayReceivePayload | Record<string, unknown>): Promise<void> {
    for (const listener of this.listeners.message ?? []) listener({ data: JSON.stringify(payload) });
    await settle();
  }

  /** Discord (or the network) closes the connection. */
  async serverClose(code: number, reason = ""): Promise<void> {
    for (const listener of this.listeners.close ?? []) listener({ code, reason });
    await settle();
  }
}

/** Waits for pending promise callbacks (the client handles events asynchronously). */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Durable Object storage in memory, remembering when the alarm is set for. */
export class FakeStorage implements GatewayStorage {
  values = new Map<string, unknown>();
  alarm: number | null = null;

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }
  async put(key: string, value: unknown): Promise<void> {
    this.values.set(key, structuredClone(value));
  }
  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }
  async setAlarm(time: number): Promise<void> {
    this.alarm = time;
  }
  async deleteAlarm(): Promise<void> {
    this.alarm = null;
  }
}
