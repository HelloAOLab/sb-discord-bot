import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/worker.js";
import { useGateway } from "../src/gateway/control.js";
import { database } from "../src/storage/database.js";
import { getSession } from "../src/storage/sessions.js";
import { mockFetch } from "./helpers/bible-api.js";
import { testPublicKeyHex } from "./helpers/keys.js";
import { saveSession } from "./helpers/sessions.js";

/** Runs the cron handler as Cloudflare would at `time`, waiting for the work it kept alive. */
async function runCron(time: number, env: Record<string, unknown>) {
  const pending: Promise<unknown>[] = [];
  worker.scheduled({ scheduledTime: time }, env, { waitUntil: (promise) => void pending.push(promise) });
  await Promise.all(pending);
}

/** A stand-in GATEWAY binding that counts wake-ups. */
function fakeGateway() {
  const wakes: string[] = [];
  const namespace = {
    idFromName: (name: string) => name,
    get: () => ({ fetch: async (url: string) => (wakes.push(url), new Response(null, { status: 204 })) }),
  };
  return { namespace, wakes };
}

afterEach(() => useGateway(undefined));

describe("scheduled (cron)", () => {
  it("starts due reading sessions every minute", async () => {
    const session = await saveSession({ startAt: Math.floor(Date.now() / 1000) - 1, reminderMinutes: 0 });
    const { discordCalls } = mockFetch();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runCron(Date.UTC(2026, 9, 12, 12, 1), { DISCORD_PUBLIC_KEY: testPublicKeyHex, DB: database(), DISCORD_TOKEN: "t" });

    expect((await getSession(session.id))!.status).toBe("started");
    expect(discordCalls).toHaveLength(1);
  });

  it("wakes the Gateway object only every 5 minutes", async () => {
    mockFetch();
    const { namespace, wakes } = fakeGateway();
    const env = { DISCORD_PUBLIC_KEY: testPublicKeyHex, DB: database(), GATEWAY: namespace };

    await runCron(Date.UTC(2026, 9, 12, 12, 1), env);
    expect(wakes).toEqual([]);
    await runCron(Date.UTC(2026, 9, 12, 12, 5), env);
    expect(wakes).toEqual(["https://gateway/wake"]);
  });
});
