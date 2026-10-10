import { beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayIntentBits, GatewayOpcodes, type GatewayMessageCreateDispatchData } from "discord-api-types/v10";
import { GatewayClient } from "../../src/gateway/client.js";
import { FakeSocket, FakeStorage, gatewayMessage } from "../helpers/gateway.js";

const TOKEN = "test-bot-token";
const START = 1_000_000;
const INTERVAL = 40_000;

const hello = { op: GatewayOpcodes.Hello, d: { heartbeat_interval: INTERVAL } };
const ack = { op: GatewayOpcodes.HeartbeatAck };
const ready = (seq: number) => ({
  op: GatewayOpcodes.Dispatch,
  t: "READY",
  s: seq,
  d: { session_id: "session-1", resume_gateway_url: "wss://resume.discord.gg", user: { username: "SeedBot" }, guilds: [] },
});
/** The ID of the message sent as event number `seq`. */
const idOf = (seq: number) => `message-${seq}`;
/** A new message as event number `seq`; each event is a different message. */
const messageEvent = (seq: number) => ({ op: GatewayOpcodes.Dispatch, t: "MESSAGE_CREATE", s: seq, d: gatewayMessage("John 3:16", { id: idOf(seq) }) });

/** A client with fake storage, sockets and clock. `random` is 0.5, so the first heartbeat is due halfway through the interval. */
function setup({ running = true, storage = new FakeStorage() } = {}) {
  const sockets: FakeSocket[] = [];
  const state = { running, now: START };
  const onMessage = vi.fn(async (_message: GatewayMessageCreateDispatchData) => false);
  const client = new GatewayClient({
    token: TOKEN,
    storage,
    openSocket: async (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    shouldRun: async () => state.running,
    onMessage,
    now: () => state.now,
    random: () => 0.5,
  });
  const socket = () => sockets.at(-1)!;
  return { client, storage, sockets, socket, state, onMessage };
}

/** Connects, receives Hello and Ready (event 1): a running session. */
async function connected(options?: Parameters<typeof setup>[0]) {
  const t = setup(options);
  await t.client.tick();
  await t.socket().receive(hello);
  await t.socket().receive(ready(1));
  return t;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GatewayClient", () => {
  describe("connecting", () => {
    it("connects and identifies with the message intents when Discord says Hello", async () => {
      const { client, socket, storage } = setup();
      await client.tick();
      expect(socket().url).toBe("wss://gateway.discord.gg?v=10&encoding=json");

      await socket().receive(hello);
      expect(socket().sent).toEqual([
        {
          op: GatewayOpcodes.Identify,
          d: {
            token: TOKEN,
            intents: GatewayIntentBits.GuildMessages | GatewayIntentBits.MessageContent,
            properties: { os: "cloudflare", browser: "sb-discord-app", device: "sb-discord-app" },
          },
        },
      ]);
      // The first heartbeat is due at a random point in the first interval.
      expect(storage.alarm).toBe(START + INTERVAL / 2);
    });

    it("saves the session when Discord is Ready, so it can be resumed later", async () => {
      const { storage } = await connected();
      expect(storage.values.get("session")).toEqual({ id: "session-1", resumeUrl: "wss://resume.discord.gg", seq: 1 });
    });

    it("doesn't connect while no server has inline verses on", async () => {
      const { client, sockets, storage } = setup({ running: false });
      await client.tick();
      expect(sockets).toEqual([]);
      expect(storage.alarm).toBeNull();
    });

    it("gives up on a connection where Discord never says Hello, and tries again", async () => {
      const { client, sockets, state } = setup();
      await client.tick();

      state.now += 10_000; // woken early: keeps waiting
      await client.tick();
      expect(sockets[0]!.closedWith).toBeUndefined();

      state.now += 20_000;
      await client.tick();
      expect(sockets[0]!.closedWith).toEqual({ code: 4000, reason: "Discord didn't say Hello" });
    });

    it("retries later when the connection can't be opened", async () => {
      const t = setup();
      const failing = new GatewayClient({
        token: TOKEN,
        storage: t.storage,
        openSocket: async () => {
          throw new Error("network down");
        },
        shouldRun: async () => true,
        onMessage: t.onMessage,
        now: () => START,
      });
      await failing.tick();
      expect(t.storage.alarm).toBe(START + 1000);
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe("heartbeats", () => {
    it("sends a heartbeat with the last event number when the alarm goes off", async () => {
      const { client, socket, state, storage } = await connected();
      state.now += INTERVAL / 2;
      await client.tick();

      expect(socket().sent.at(-1)).toEqual({ op: GatewayOpcodes.Heartbeat, d: 1 });
      expect(storage.alarm).toBe(state.now + INTERVAL);
    });

    it("doesn't send one early when woken before it's due (e.g. by /setinlineverses)", async () => {
      const { client, socket, storage } = await connected();
      const sent = socket().sent.length;
      await client.tick();

      expect(socket().sent).toHaveLength(sent);
      expect(storage.alarm).toBe(START + INTERVAL / 2);
    });

    it("answers Discord's request for an immediate heartbeat", async () => {
      const { socket } = await connected();
      await socket().receive({ op: GatewayOpcodes.Heartbeat });
      expect(socket().sent.at(-1)).toEqual({ op: GatewayOpcodes.Heartbeat, d: 1 });
    });

    it("keeps going while Discord acknowledges heartbeats", async () => {
      const { client, socket, sockets, state } = await connected();
      state.now += INTERVAL / 2;
      await client.tick();
      await socket().receive(ack);
      state.now += INTERVAL;
      await client.tick();

      expect(sockets).toHaveLength(1);
      expect(socket().sent.filter((p) => p.op === GatewayOpcodes.Heartbeat)).toHaveLength(2);
    });

    it("reconnects and resumes when a heartbeat isn't acknowledged (a dead connection)", async () => {
      const { client, sockets, socket, state } = await connected();
      state.now += INTERVAL / 2;
      await client.tick(); // heartbeat, never acknowledged
      state.now += INTERVAL;
      await client.tick();

      expect(sockets[0]!.closedWith?.code).toBe(4000); // not 1000, which would end the session

      state.now += 1000;
      await client.tick();
      expect(socket().url).toBe("wss://resume.discord.gg?v=10&encoding=json");
      await socket().receive(hello);
      expect(socket().sent).toEqual([{ op: GatewayOpcodes.Resume, d: { token: TOKEN, session_id: "session-1", seq: 1 } }]);
    });
  });

  describe("reconnecting", () => {
    it("resumes a saved session after the object restarts (e.g. a deploy)", async () => {
      const storage = new FakeStorage();
      await storage.put("session", { id: "session-1", resumeUrl: "wss://resume.discord.gg", seq: 42 });
      const { client, socket } = setup({ storage });

      await client.tick();
      await socket().receive(hello);
      expect(socket().url).toBe("wss://resume.discord.gg?v=10&encoding=json");
      expect(socket().sent).toEqual([{ op: GatewayOpcodes.Resume, d: { token: TOKEN, session_id: "session-1", seq: 42 } }]);
    });

    it("reconnects right away when Discord asks to", async () => {
      const { sockets, storage, state } = await connected();
      await sockets[0]!.receive({ op: GatewayOpcodes.Reconnect });

      expect(sockets[0]!.closedWith?.code).toBe(4000);
      expect(storage.alarm).toBe(state.now);
    });

    it("identifies afresh when Discord says the session can't be resumed", async () => {
      const { client, sockets, socket, state, storage } = await connected();
      await sockets[0]!.receive({ op: GatewayOpcodes.InvalidSession, d: false });
      expect(storage.values.has("session")).toBe(false);

      state.now = storage.alarm!;
      await client.tick();
      await socket().receive(hello);
      expect(socket().url).toBe("wss://gateway.discord.gg?v=10&encoding=json");
      expect(socket().sent[0].op).toBe(GatewayOpcodes.Identify);
    });

    it("waits longer after each failed attempt, and resets once connected", async () => {
      const { client, socket, state, storage } = await connected();
      await socket().serverClose(1006);
      expect(storage.alarm).toBe(state.now + 1000);

      state.now = storage.alarm!;
      await client.tick();
      await socket().serverClose(1006);
      expect(storage.alarm).toBe(state.now + 2000);

      state.now = storage.alarm!;
      await client.tick();
      await socket().receive(hello);
      await socket().receive({ op: GatewayOpcodes.Dispatch, t: "RESUMED", s: 2, d: {} });
      await socket().serverClose(1006);
      expect(storage.alarm).toBe(state.now + 1000);
    });

    it("forgets the session when Discord says it timed out", async () => {
      const { socket, storage } = await connected();
      await socket().serverClose(4009);
      expect(storage.values.has("session")).toBe(false);
    });

    it("waits 15 minutes after a close retrying won't fix, even when woken by the cron", async () => {
      const { client, sockets, socket, state, storage } = await connected();
      await socket().serverClose(4014);

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Message Content intent isn't enabled"));
      expect(storage.values.has("session")).toBe(false);
      const retryAt = state.now + 15 * 60_000;
      expect(storage.alarm).toBe(retryAt);

      state.now += 5 * 60_000; // the cron wakes it
      await client.tick();
      expect(sockets).toHaveLength(1);
      expect(storage.alarm).toBe(retryAt);
    });

    it("keeps that wait when inline verses are turned off and on again", async () => {
      const { client, sockets, socket, state, storage } = await connected();
      await socket().serverClose(4014);
      const retryAt = storage.alarm!;

      state.running = false;
      client.wake();
      await client.tick(); // /setinlineverses off
      state.running = true;
      client.wake();
      await client.tick(); // /setinlineverses on

      expect(sockets).toHaveLength(1);
      expect(storage.alarm).toBe(retryAt);
    });

    it("keeps that wait across a restart", async () => {
      const { socket, storage, state } = await connected();
      await socket().serverClose(4004);

      const restarted = setup({ storage });
      restarted.state.now = state.now + 60_000;
      await restarted.client.tick();
      expect(restarted.sockets).toEqual([]);
    });
  });

  describe("stopping", () => {
    it("disconnects and ends the session once no server has inline verses on", async () => {
      const { client, sockets, state, storage } = await connected();
      state.running = false;
      client.wake(); // as /setinlineverses off does
      await client.tick();

      expect(sockets[0]!.closedWith?.code).toBe(1000);
      expect(storage.values.has("session")).toBe(false);
      expect(storage.alarm).toBeNull();
    });

    it("ignores events from a socket it has already closed", async () => {
      const { client, sockets, state, onMessage } = await connected();
      state.running = false;
      client.wake(); // as /setinlineverses off does
      await client.tick();

      await sockets[0]!.receive(messageEvent(2));
      expect(onMessage).not.toHaveBeenCalled();
    });
  });

  describe("messages", () => {
    /** Makes the handler's next call wait until the returned function is called with its result. */
    const holdNextReply = (onMessage: ReturnType<typeof setup>["onMessage"]) => {
      let finish!: (replied: boolean) => void;
      onMessage.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
      return async (replied: boolean) => {
        finish(replied);
        await new Promise((resolve) => setTimeout(resolve, 0));
      };
    };

    it("passes each new message to the handler", async () => {
      const { socket, onMessage } = await connected();
      await socket().receive(messageEvent(2));
      expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ content: "John 3:16" }));
    });

    it("saves its place and remembers the message after replying", async () => {
      const { socket, onMessage, storage } = await connected();
      onMessage.mockResolvedValueOnce(true);
      await socket().receive(messageEvent(5));
      expect(storage.values.get("session")).toMatchObject({ seq: 5, replied: [idOf(5)] });
    });

    it("doesn't save its place for messages it ignored (that waits for the next heartbeat)", async () => {
      const { socket, storage } = await connected();
      await socket().receive(messageEvent(5));
      expect(storage.values.get("session")).toMatchObject({ seq: 1 });
    });

    it("doesn't save past a message whose reply is still being sent, so a restart can't lose it", async () => {
      const { client, socket, onMessage, state, storage } = await connected();
      const finish = holdNextReply(onMessage);
      await socket().receive(messageEvent(10)); // still replying
      await socket().receive(messageEvent(11)); // ignored

      state.now += INTERVAL / 2;
      await client.tick(); // a heartbeat saves progress
      expect(storage.values.get("session")).toMatchObject({ seq: 9 });

      await finish(true);
      expect(storage.values.get("session")).toMatchObject({ seq: 11 });
    });

    it("saves the later reply's progress only up to an earlier reply still being sent", async () => {
      const { socket, onMessage, storage } = await connected();
      const finish = holdNextReply(onMessage);
      onMessage.mockResolvedValueOnce(true);

      await socket().receive(messageEvent(10)); // still replying
      await socket().receive(messageEvent(11)); // replied
      expect(storage.values.get("session")).toMatchObject({ seq: 9, replied: [idOf(11)] });

      await finish(true);
      expect(storage.values.get("session")).toMatchObject({ seq: 11, replied: [idOf(11), idOf(10)] });
    });

    it("doesn't answer a replayed message twice after resuming", async () => {
      const storage = new FakeStorage();
      await storage.put("session", { id: "session-1", resumeUrl: "wss://resume.discord.gg", seq: 9, replied: [idOf(11)] });
      const { client, socket, onMessage } = setup({ storage });
      await client.tick();
      await socket().receive(hello);

      await socket().receive(messageEvent(10)); // never answered: handled now
      await socket().receive(messageEvent(11)); // answered before the restart: skipped
      expect(onMessage.mock.calls.map(([message]) => message.id)).toEqual([idOf(10)]);
    });

    it("remembers only the last 50 messages it answered", async () => {
      const { socket, onMessage, storage } = await connected();
      onMessage.mockResolvedValue(true);
      for (let seq = 2; seq <= 60; seq++) await socket().receive(messageEvent(seq));
      const replied = storage.values.get("session") as { replied: string[] };
      expect(replied.replied).toHaveLength(50);
      expect(replied.replied.at(-1)).toBe(idOf(60));
    });
  });

  describe("checking whether to run", () => {
    it("asks once, not on every heartbeat", async () => {
      const t = setup();
      const shouldRun = vi.fn(async () => true);
      const client = new GatewayClient({ token: TOKEN, storage: t.storage, openSocket: async (url) => new FakeSocket(url), shouldRun, onMessage: t.onMessage, now: () => t.state.now });
      for (let i = 0; i < 5; i++) await client.tick();
      expect(shouldRun).toHaveBeenCalledTimes(1);
    });

    it("asks again after being woken", async () => {
      const t = setup();
      const shouldRun = vi.fn(async () => true);
      const client = new GatewayClient({ token: TOKEN, storage: t.storage, openSocket: async (url) => new FakeSocket(url), shouldRun, onMessage: t.onMessage, now: () => t.state.now });
      await client.tick();
      client.wake();
      await client.tick();
      expect(shouldRun).toHaveBeenCalledTimes(2);
    });
  });
});
