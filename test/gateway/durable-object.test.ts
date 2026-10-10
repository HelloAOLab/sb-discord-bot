import { beforeEach, describe, expect, it, vi } from "vitest";
import { Gateway } from "../../src/gateway/durable-object.js";
import { useGateway, wakeGateway, type GatewayNamespace } from "../../src/gateway/control.js";
import { database } from "../../src/storage/database.js";
import { setInlineVersesEnabled } from "../../src/storage/guild-settings.js";
import { FakeStorage, TEST_GUILD } from "../helpers/gateway.js";
import { testPublicKeyHex } from "../helpers/keys.js";

const env = (extra: Record<string, unknown> = {}) => ({ DISCORD_PUBLIC_KEY: testPublicKeyHex, DB: database(), ...extra });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Gateway Durable Object", () => {
  it("runs its alarm right away when woken", async () => {
    const storage = new FakeStorage();
    const gateway = new Gateway({ storage }, env({ DISCORD_TOKEN: "token" }));

    const res = await gateway.fetch(new Request("https://gateway/wake", { method: "POST" }));
    expect(res.status).toBe(204);
    expect(storage.alarm).toBeGreaterThan(Date.now() - 1000);
  });

  it("answers anything else with 404", async () => {
    const gateway = new Gateway({ storage: new FakeStorage() }, env());
    expect((await gateway.fetch(new Request("https://gateway/other"))).status).toBe(404);
  });

  it("explains a missing DISCORD_TOKEN instead of connecting", async () => {
    await setInlineVersesEnabled(TEST_GUILD, true);
    const fetch = vi.spyOn(globalThis, "fetch");
    await new Gateway({ storage: new FakeStorage() }, env()).alarm();

    expect(fetch).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("DISCORD_TOKEN is missing"));
  });

  it("opens the WebSocket with an upgrade request over https, and retries if Discord refuses", async () => {
    await setInlineVersesEnabled(TEST_GUILD, true);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("no", { status: 400 }));
    const storage = new FakeStorage();
    await new Gateway({ storage }, env({ DISCORD_TOKEN: "token" })).alarm();

    expect(fetch).toHaveBeenCalledWith("https://gateway.discord.gg?v=10&encoding=json", { headers: { Upgrade: "websocket" } });
    expect(console.error).toHaveBeenCalledWith("[gateway] Couldn't connect:", expect.any(Error));
    expect(storage.alarm).not.toBeNull();
  });

  it("stays disconnected while no server has inline verses on", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    await new Gateway({ storage: new FakeStorage() }, env({ DISCORD_TOKEN: "token" })).alarm();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("wakeGateway", () => {
  /** A stand-in for the GATEWAY binding that records which object was asked to do what. */
  function fakeNamespace(status = 204) {
    const calls: { name: unknown; url: string; method?: string }[] = [];
    const namespace: GatewayNamespace = {
      idFromName: (name) => name,
      get: (id) => ({
        fetch: async (url, init) => {
          calls.push({ name: id, url, method: init?.method });
          return new Response(null, { status });
        },
      }),
    };
    return { namespace, calls };
  }

  it("does nothing without a GATEWAY binding (tests, or a misconfigured Worker)", async () => {
    await expect(wakeGateway()).resolves.toBeUndefined();
  });

  it("wakes the one Gateway object", async () => {
    const { namespace, calls } = fakeNamespace();
    useGateway(namespace);
    await wakeGateway();
    expect(calls).toEqual([{ name: "main", url: "https://gateway/wake", method: "POST" }]);
  });

  it("throws if the object fails", async () => {
    useGateway(fakeNamespace(500).namespace);
    await expect(wakeGateway()).rejects.toThrow(/500/);
  });
});
