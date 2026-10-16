import { describe, expect, it } from "vitest";
import { ButtonStyle, ComponentType, MessageFlags } from "discord-api-types/v10";
import { parseCustomId } from "../../src/interactions/components/custom-id.js";
import { announcementMessage, personalLinkMessage, reminderMessage, startMessage } from "../../src/sessions/messages.js";
import { seedBibleSessionUrl } from "../../src/seedbible/links.js";
import type { Session } from "../../src/storage/sessions.js";
import { NOW } from "../helpers/sessions.js";

const session: Session = {
  id: "7f3a03ad-65ba-4179-94fb-cac586665e3a",
  guildId: "g",
  channelId: "c",
  creatorId: "111",
  title: null,
  book: "GEN",
  bookName: "Genesis",
  chapter: 5,
  status: "scheduled",
  localTime: "2026-10-12T09:00",
  timeZone: "America/New_York",
  startAt: NOW + 3600,
  reminderMinutes: 15,
  reminderSent: false,
};

const buttons = (message: { components?: unknown[] }) =>
  (message.components ?? []).flatMap((row: any) => row.components).map((b: any) => ({ label: b.label, ...parseCustomId(b.custom_id ?? "") }));

describe("seedBibleSessionUrl", () => {
  it("builds the reader link with the session ID", () => {
    expect(seedBibleSessionUrl({ lang: "en", translation: "AAB", book: "Genesis", chapter: 5, sessionId: `session-${session.id}` })).toBe(
      "https://seedbible.org/en/AAB/genesis/5?sessionId=session-7f3a03ad-65ba-4179-94fb-cac586665e3a&source=discord_bot",
    );
  });

  it("uses each reader's language and translation, and the site's book names", () => {
    expect(seedBibleSessionUrl({ lang: "pt-BR", translation: "spa_r09", book: "Song of Solomon", chapter: 2, sessionId: "session-x" })).toBe(
      "https://seedbible.org/pt-BR/spa_r09/song-of-solomon/2?sessionId=session-x&source=discord_bot",
    );
  });
});

describe("announcementMessage", () => {
  it("shows a scheduled session's time, reminder and who's going, with Join, Leave and Cancel", () => {
    const message = announcementMessage({ ...session, title: "Wednesday study" }, ["111", "222"]);
    expect(message.content).toBe(
      [
        "📖 **Wednesday study**",
        "Reading **Genesis 5** together in Seed Bible, planned by <@111>.",
        `🗓️ Starts <t:${NOW + 3600}:F> (<t:${NOW + 3600}:R>)`,
        "⏰ Reminder 15 minutes before",
        "👥 Going (2): <@111>, <@222>",
        "-# Join to be pinged when it starts and get your own link.",
      ].join("\n"),
    );
    expect(buttons(message)).toEqual([
      { label: "Join", id: "session", args: ["join", session.id] },
      { label: "Leave", id: "session", args: ["leave", session.id] },
      { label: "Cancel session", id: "session", args: ["cancel", session.id] },
    ]);
  });

  it("never pings the people it lists", () => {
    expect(announcementMessage(session, ["222"]).allowed_mentions).toEqual({ parse: [] });
  });

  it("doesn't let a title hide a link behind innocent text", () => {
    const content = announcementMessage({ ...session, title: "[Open Seed Bible](https://evil.example)" }, []).content!;
    expect(content.split("\n")[0]).toBe("📖 **\\[Open Seed Bible\\](https://evil.example)**");
  });

  it("names the reading when there's no title, and says when nobody is going", () => {
    const content = announcementMessage({ ...session, reminderMinutes: 0 }, []).content!;
    expect(content).toMatch(/^📖 \*\*Reading Genesis 5 together\*\*/);
    expect(content).toContain("👥 Going (0): nobody yet");
    expect(content).not.toContain("Reminder");
  });

  it("lists at most 30 people", () => {
    const going = Array.from({ length: 33 }, (_, i) => String(1000 + i));
    expect(announcementMessage(session, going).content).toContain("<@1029> and 3 more");
  });

  it("escapes a title so it can't format text, mention anyone, or break lines", () => {
    const content = announcementMessage({ ...session, title: "**hi** <@&123> @everyone\nline" }, []).content!;
    expect(content.split("\n")[0]).toBe("📖 **\\*\\*hi\\*\\* \\<@&123\\> @everyone line**");
  });

  it("offers Get my link once the session has started", () => {
    const message = announcementMessage({ ...session, status: "started", startAt: NOW }, ["111"]);
    expect(message.content).toContain(`started by <@111> <t:${NOW}:R>`);
    expect(buttons(message)).toEqual([{ label: "Get my link", id: "session", args: ["link", session.id] }]);
  });

  it("shows a cancelled session crossed out, without buttons", () => {
    const message = announcementMessage({ ...session, status: "cancelled" }, ["111"]);
    expect(message.content).toBe("~~📖 **Reading Genesis 5 together**~~\nThis session to read **Genesis 5** was cancelled.");
    expect(message.components).toEqual([]);
  });
});

describe("reminder and start messages", () => {
  it("ping exactly the people who joined", () => {
    const reminder = reminderMessage({ ...session, title: "@everyone" }, ["111", "222"]);
    expect(reminder.content).toBe(`<@111> <@222>\n⏰ **@everyone** (Genesis 5) starts <t:${NOW + 3600}:R> (<t:${NOW + 3600}:t>).`);
    expect(reminder.allowed_mentions).toEqual({ parse: [], users: ["111", "222"] });

    const start = startMessage(session, ["111"]);
    expect(start.content).toBe("<@111>\n📖 **Reading Genesis 5 together** is starting now! Click **Get my link** to open Genesis 5 in Seed Bible.");
    expect(start.allowed_mentions).toEqual({ parse: [], users: ["111"] });
    expect(buttons(start)).toEqual([{ label: "Get my link", id: "session", args: ["link", session.id] }]);
  });

  it("ping nobody when nobody joined, and point to Join", () => {
    const reminder = reminderMessage(session, []);
    expect(reminder.content).toMatch(/^⏰ .* Click \*\*Join\*\* on the announcement/);
    expect(reminder.allowed_mentions).toEqual({ parse: [], users: [] });
  });

  it("ping at most 60 people, and say how many more joined", () => {
    const going = Array.from({ length: 65 }, (_, i) => String(1000 + i));
    const start = startMessage(session, going);
    expect(start.allowed_mentions!.users).toHaveLength(60);
    expect(start.content).toContain("<@1059> (and 5 more who joined)");
    expect(start.content!.length).toBeLessThan(2000);
  });
});

describe("personalLinkMessage", () => {
  const link = (message: ReturnType<typeof personalLinkMessage>) => (message.components![0] as any).components[0];

  it("links to the session in the user's language and translation, privately", () => {
    const message = personalLinkMessage(session, { translation: "BSB", lang: "es" }, { locale: "en-US", button: true });
    expect(message.flags).toBe(MessageFlags.Ephemeral);
    expect(message.content).toMatch(/^Your link to read \*\*Genesis 5\*\* together \(BSB · Seed Bible in Spanish/);
    expect(link(message)).toEqual({
      type: ComponentType.Button,
      style: ButtonStyle.Link,
      label: "Open Genesis 5 →",
      url: `https://seedbible.org/es/BSB/genesis/5?sessionId=session-${session.id}&source=discord_bot`,
    });
  });

  it("falls back to the Discord language and Seed Bible's default translation", () => {
    expect(link(personalLinkMessage(session, {}, { locale: "fr", button: true })).url).toBe(
      `https://seedbible.org/fr/AAB/genesis/5?sessionId=session-${session.id}&source=discord_bot`,
    );
    expect(link(personalLinkMessage(session, {}, { locale: "xx", button: true })).url).toMatch(/^https:\/\/seedbible\.org\/en\/AAB\//);
  });

  it("writes the link out when the server turned link buttons off", () => {
    const message = personalLinkMessage(session, {}, { locale: "en-US", button: false });
    expect(message.components).toEqual([]);
    expect(message.content).toContain(`<https://seedbible.org/en/AAB/genesis/5?sessionId=session-${session.id}&source=discord_bot>`);
  });
});
