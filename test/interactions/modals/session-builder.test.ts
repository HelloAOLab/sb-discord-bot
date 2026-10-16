import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ComponentType,
  InteractionContextType,
  InteractionResponseType,
  MessageFlags,
  PermissionFlagsBits,
} from "discord-api-types/v10";
import { bibleApi } from "../../../src/bible/api.js";
import { launchSession } from "../../../src/interactions/commands/launchsession.js";
import { commands } from "../../../src/interactions/commands/index.js";
import { runDeferredWork } from "../../../src/interactions/deferred.js";
import { modals } from "../../../src/interactions/modals/index.js";
import { sessionBuilder } from "../../../src/interactions/modals/session-builder.js";
import { parseCustomId } from "../../../src/interactions/components/custom-id.js";
import { database } from "../../../src/storage/database.js";
import { participants, type Session } from "../../../src/storage/sessions.js";
import { setUserPreferences } from "../../../src/storage/user-settings.js";
import { UserFacingError } from "../../../src/utils/errors.js";
import { mockFetch } from "../../helpers/bible-api.js";
import { chatInputInteraction, field, modalSubmitInteraction, withAppPermissions } from "../../helpers/interactions.js";
import { NOW, TEST_USER } from "../../helpers/sessions.js";

const CAN_POST = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages;

/** The form as submitted, with the bot allowed to post in the channel. */
function submit(values: { passage?: string; title?: string; when?: string | null; reminder?: string | null }, overrides = {}) {
  const fields = [
    field.text("passage", values.passage ?? "Genesis 5"),
    field.text("title", values.title ?? ""),
    field.radio("when", values.when === undefined ? "now" : values.when),
    field.radio("reminder", values.reminder === undefined ? "15" : values.reminder),
  ];
  return withAppPermissions(modalSubmitInteraction("session-builder", fields, overrides), CAN_POST);
}

/** Submits the form, runs the deferred work, and returns the message it edited in. */
async function submitAndRun(values: Parameters<typeof submit>[0], overrides = {}) {
  const { discordCalls } = mockFetch();
  const response = await sessionBuilder.execute(submit(values, overrides), []);
  await runDeferredWork(response);
  return { response, discordCalls, message: discordCalls.at(-1)?.body };
}

async function savedSessions(): Promise<(Session & Record<string, unknown>)[]> {
  return (await database().prepare("SELECT * FROM sessions").all<any>()).results;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.useRealTimers());

describe("/launchsession", () => {
  it("is registered, and only in servers", () => {
    expect(commands.get("launchsession")).toBe(launchSession);
    expect(launchSession.data.contexts).toEqual([InteractionContextType.Guild]);
  });

  it("opens the session form, which the router can find", async () => {
    const response = await launchSession.execute(chatInputInteraction("launchsession"));
    expect(response.type).toBe(InteractionResponseType.Modal);
    const data = (response as any).data;
    expect(modals.get(data.custom_id)).toBe(sessionBuilder);
    expect(data.components.map((label: any) => [label.type, label.component.type, label.component.custom_id])).toEqual([
      [ComponentType.Label, ComponentType.TextInput, "passage"],
      [ComponentType.Label, ComponentType.TextInput, "title"],
      [ComponentType.Label, ComponentType.RadioGroup, "when"],
      [ComponentType.Label, ComponentType.RadioGroup, "reminder"],
    ]);
  });
});

describe("session form", () => {
  it("starts a session now: announces it publicly with Get my link", async () => {
    const { response, discordCalls, message } = await submitAndRun({ passage: "Genesis 5", title: "Morning reading" });

    // Public: the whole channel sees the announcement.
    expect(response).toEqual({ type: InteractionResponseType.DeferredChannelMessageWithSource });
    expect(discordCalls).toHaveLength(1);
    expect(discordCalls[0]).toMatchObject({ method: "PATCH", url: expect.stringMatching(/\/messages\/(@|%40)original$/) });
    expect(message.content).toMatch(/^📖 \*\*Morning reading\*\*\nReading \*\*Genesis 5\*\* together in Seed Bible, started by <@100000000000000001>/);
    expect(message.allowed_mentions).toEqual({ parse: [] });

    const [session] = await savedSessions();
    expect(session).toMatchObject({ status: "started", book: "GEN", book_name: "Genesis", chapter: 5, title: "Morning reading", start_at: NOW, reminder_minutes: 0 });
    expect(message.components[0].components[0]).toMatchObject({ label: "Get my link", custom_id: `session:link:${session!.id}` });
    expect(await participants(session!.id)).toEqual([TEST_USER]);
  });

  it("reads the passage with the inline-verses parser, using its first chapter", async () => {
    await submitAndRun({ passage: "jn 3:16-4:2" });
    expect((await savedSessions())[0]).toMatchObject({ book: "JHN", book_name: "John", chapter: 3 });
  });

  it("uses Seed Bible's English book names, which its links need", async () => {
    await submitAndRun({ passage: "Song of Songs 2" });
    expect((await savedSessions())[0]).toMatchObject({ book: "SNG", book_name: "Song of Solomon" });
  });

  it("shows the private time picker for a session scheduled for later", async () => {
    await setUserPreferences(TEST_USER, { timeZone: "Asia/Tokyo" });
    const { response, message } = await submitAndRun({ when: "later", reminder: "60" });

    expect(response).toEqual({ type: InteractionResponseType.DeferredChannelMessageWithSource, data: { flags: MessageFlags.Ephemeral } });
    const [session] = await savedSessions();
    // 12:00 UTC is 21:00 in Tokyo, so the picker starts at the next whole hour that's an hour away.
    expect(session).toMatchObject({ status: "draft", time_zone: "Asia/Tokyo", local_time: "2026-10-12T22:00", start_at: null, reminder_minutes: 60 });
    expect(message.content).toMatch(/^\*\*When should we read Genesis 5 together\?\*\*/);
    expect(parseCustomId(message.components[0].components[0].custom_id)).toEqual({ id: "session-time", args: ["day", session!.id, "1"] });
  });

  it("guesses the time zone from the Discord language when none is saved", async () => {
    await submitAndRun({ when: "later" }, { locale: "pt-BR" });
    expect((await savedSessions())[0]).toMatchObject({ time_zone: "America/Sao_Paulo" });
  });

  it("uses the default reminder when none or an unknown one is chosen", async () => {
    await submitAndRun({ when: "later", reminder: null });
    await submitAndRun({ when: "later", reminder: "7" });
    expect((await savedSessions()).map((s) => s.reminder_minutes)).toEqual([15, 15]);
  });

  it("explains a passage it can't read, at once and privately", () => {
    expect(() => sessionBuilder.execute(submit({ passage: "hello there" }), [])).toThrow(
      new UserFacingError(`I couldn't find a Bible chapter in "hello there". Try something like \`Genesis 5\` or \`John 3\`.`),
    );
  });

  it("explains a chapter the book doesn't have", () => {
    // The reference parser knows each book's chapters, so this needs no network.
    expect(() => sessionBuilder.execute(submit({ passage: "Genesis 51" }), [])).toThrow(/couldn't find a Bible chapter in "Genesis 51"/);
  });

  it("checks the chapter against Seed Bible's translation too", async () => {
    mockFetch();
    const { books } = await bibleApi.getTranslationBooks("AAB");
    vi.spyOn(bibleApi, "getTranslationBooks").mockResolvedValue({
      books: books.map((b) => (b.id === "GEN" ? { ...b, lastChapterNumber: 4, numberOfChapters: 4 } : b)),
    } as Awaited<ReturnType<typeof bibleApi.getTranslationBooks>>);

    const { discordCalls } = await submitAndRun({ passage: "Genesis 5" });
    expect(discordCalls.at(-1)).toMatchObject({ method: "POST", body: { content: "Genesis has chapters 1–4.", flags: MessageFlags.Ephemeral } });
    expect(await savedSessions()).toEqual([]);
  });

  it("refuses to schedule where the bot can't post its reminder and start messages", () => {
    const interaction = withAppPermissions(submit({ when: "later" }), PermissionFlagsBits.ViewChannel);
    expect(() => sessionBuilder.execute(interaction, [])).toThrow(/I can't post in this channel/);
  });

  it("still starts a session now where the bot can't post, since that's a reply", async () => {
    const interaction = withAppPermissions(submit({}), 0n);
    mockFetch();
    await runDeferredWork(await sessionBuilder.execute(interaction, []));
    expect((await savedSessions())[0]).toMatchObject({ status: "started" });
  });

  it("works only in servers", () => {
    expect(() => sessionBuilder.execute(submit({}, { guild_id: undefined }), [])).toThrow(/use `\/launchsession` in a server channel/);
  });
});
