import { describe, expect, it, vi } from "vitest";
import { runDueSessions } from "../../src/sessions/scheduler.js";
import { addParticipant, getSession } from "../../src/storage/sessions.js";
import { mockFetch } from "../helpers/bible-api.js";
import { NOW, TEST_CHANNEL, saveSession } from "../helpers/sessions.js";

const TOKEN = "test-bot-token";
const CHANNEL_MESSAGES = `https://discord.com/api/v10/channels/${TEST_CHANNEL}/messages`;

describe("runDueSessions", () => {
  it("posts the reminder once its time comes, pinging who joined", async () => {
    const session = await saveSession({ startAt: NOW + 10 * 60, reminderMinutes: 15 });
    await addParticipant(session.id, "222");
    const { discordCalls } = mockFetch();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runDueSessions(TOKEN, NOW);
    await runDueSessions(TOKEN, NOW + 60);

    expect(discordCalls).toEqual([
      {
        url: CHANNEL_MESSAGES,
        method: "POST",
        body: { content: expect.stringMatching(/^<@222>\n⏰ /), allowed_mentions: { parse: [], users: ["222"] } },
      },
    ]);
    expect((await getSession(session.id))!.reminderSent).toBe(true);
  });

  it("posts the start message at the start time and marks the session started", async () => {
    const session = await saveSession({ startAt: NOW, reminderMinutes: 0 });
    await addParticipant(session.id, "222");
    await addParticipant(session.id, "333");
    const { spy, discordCalls } = mockFetch();
    vi.spyOn(console, "log").mockImplementation(() => {});

    await runDueSessions(TOKEN, NOW - 1);
    expect(discordCalls).toEqual([]);

    await runDueSessions(TOKEN, NOW);
    await runDueSessions(TOKEN, NOW + 60);

    expect(discordCalls).toHaveLength(1);
    expect(discordCalls[0]!.body).toMatchObject({
      content: expect.stringMatching(/^<@222> <@333>\n📖 .* is starting now!/),
      allowed_mentions: { parse: [], users: ["222", "333"] },
      components: [{ components: [{ label: "Get my link", custom_id: `session:link:${session.id}` }] }],
    });
    expect((spy.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ Authorization: `Bot ${TOKEN}` });
    expect((await getSession(session.id))!.status).toBe("started");
  });

  it("doesn't post for sessions not scheduled", async () => {
    await saveSession({ startAt: NOW - 60, status: "cancelled" });
    await saveSession({ startAt: NOW - 60, status: "started" });
    const { discordCalls } = mockFetch();
    await runDueSessions(TOKEN, NOW);
    expect(discordCalls).toEqual([]);
  });

  it("doesn't retry a message Discord rejected", async () => {
    const session = await saveSession({ startAt: NOW, reminderMinutes: 0 });
    const { discordCalls } = mockFetch({ discordStatus: 403 });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await runDueSessions(TOKEN, NOW);
    await runDueSessions(TOKEN, NOW + 60);

    expect(discordCalls).toHaveLength(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining(`Couldn't post the start message for session ${session.id}`), expect.any(Error));
    expect((await getSession(session.id))!.status).toBe("started");
  });

  it("logs instead of posting without a bot token", async () => {
    await saveSession({ startAt: NOW, reminderMinutes: 0 });
    const { discordCalls } = mockFetch();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await runDueSessions(undefined, NOW);

    expect(discordCalls).toEqual([]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("DISCORD_TOKEN is missing"));
  });

  it("deletes sessions that started 30 days ago", async () => {
    const old = await saveSession({ status: "started", startAt: NOW - 30 * 24 * 60 * 60 - 1 });
    const recent = await saveSession({ status: "started", startAt: NOW - 29 * 24 * 60 * 60 });
    mockFetch();
    await runDueSessions(TOKEN, NOW);
    expect(await getSession(old.id)).toBeNull();
    expect(await getSession(recent.id)).not.toBeNull();
  });

  it("deletes time pickers abandoned for a day", async () => {
    const draft = await saveSession({ status: "draft", startAt: null });
    mockFetch();
    await runDueSessions(TOKEN, Math.floor(Date.now() / 1000) + 25 * 60 * 60);
    expect(await getSession(draft.id)).toBeNull();
  });
});
