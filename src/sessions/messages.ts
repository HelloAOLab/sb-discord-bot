import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
  type APIInteractionResponseCallbackData,
  type RESTPostAPIChannelMessageJSONBody,
} from "discord-api-types/v10";
import { customId } from "../interactions/components/custom-id.js";
import { plainLink } from "../interactions/open-link.js";
import { SEED_BIBLE_DEFAULT_TRANSLATION, seedBibleSessionUrl } from "../seedbible/links.js";
import { describeUiLanguage, findUiLanguage } from "../seedbible/ui-languages.js";
import type { Session } from "../storage/sessions.js";
import type { UserPreferences } from "../storage/user-settings.js";
import { escapeMarkdown, truncate } from "../utils/text.js";

// The messages a reading session shows in the channel:
//
//   1. the announcement, posted by /launchsession: what's being read and when, who's going, and
//      Join / Leave / Cancel buttons (a "Get my link" button once it has started)
//   2. the reminder, posted by the bot shortly before, pinging everyone who joined
//   3. the start message, posted by the bot at the start time, pinging them with "Get my link"
//
// "Get my link" replies privately with a Seed Bible link to the session in the clicker's own
// interface language and translation (/preferences). Only (2) and (3) ping anyone, and only the
// people who joined; the "going" list in (1) shows names without notifying them.

/** The component id of the session buttons: "session:<action>:<session id>". */
export const SESSION_BUTTONS_ID = "session";
export const SESSION_ACTIONS = ["join", "leave", "cancel", "link"] as const;
export type SessionAction = (typeof SESSION_ACTIONS)[number];

/** Names listed under "Going" before "and N more". */
const MAX_LISTED = 30;
/**
 * People pinged by one reminder or start message. Each mention is about 22 characters, so this
 * keeps the message well under Discord's 2,000-character limit.
 */
const MAX_PINGS = 60;

type Row = APIActionRowComponent<APIComponentInMessageActionRow>;

/** "Genesis 5" */
export const describeReading = (session: Pick<Session, "bookName" | "chapter">) => `${session.bookName} ${session.chapter}`;

/** The session's title (kept to one line), or "Reading Genesis 5 together". */
const headline = (session: Session) =>
  escapeMarkdown((session.title ?? `Reading ${describeReading(session)} together`).replace(/\s+/g, " "));

/** The announcement, redrawn whenever someone joins or leaves. */
export function announcementMessage(session: Session, going: string[]): APIInteractionResponseCallbackData {
  const reading = `**${describeReading(session)}**`;
  const lines = [`📖 **${headline(session)}**`];
  let rows: Row[] = [];

  if (session.status === "cancelled") {
    lines[0] = `~~📖 **${headline(session)}**~~`;
    lines.push(`This session to read ${reading} was cancelled.`);
  } else if (session.status === "started") {
    lines.push(`Reading ${reading} together in Seed Bible, started by <@${session.creatorId}>${session.startAt ? ` <t:${session.startAt}:R>` : ""}.`);
    lines.push("Click **Get my link** to open it in your own language and Bible translation.");
    rows = [buttonRow(session, [["link", "Get my link", ButtonStyle.Primary]])];
  } else {
    lines.push(`Reading ${reading} together in Seed Bible, planned by <@${session.creatorId}>.`);
    if (session.startAt) lines.push(`🗓️ Starts <t:${session.startAt}:F> (<t:${session.startAt}:R>)`);
    if (session.reminderMinutes > 0) lines.push(`⏰ Reminder ${describeMinutes(session.reminderMinutes)} before`);
    lines.push(`👥 Going (${going.length}): ${going.length === 0 ? "nobody yet" : listMentions(going)}`);
    lines.push("-# Join to be pinged when it starts and get your own link.");
    rows = [
      buttonRow(session, [
        ["join", "Join", ButtonStyle.Success],
        ["leave", "Leave", ButtonStyle.Secondary],
        ["cancel", "Cancel session", ButtonStyle.Danger],
      ]),
    ];
  }

  // The title is user text and the list names people: never ping anyone by editing this message.
  return { content: lines.join("\n"), components: rows, allowed_mentions: { parse: [] } };
}

/** Posted by the bot `reminderMinutes` before the start, pinging everyone who joined. */
export function reminderMessage(session: Session, going: string[]): RESTPostAPIChannelMessageJSONBody {
  const when = session.startAt ? `<t:${session.startAt}:R> (<t:${session.startAt}:t>)` : "soon";
  const text = `⏰ **${headline(session)}** (${describeReading(session)}) starts ${when}.`;
  return pingMessage(going, going.length > 0 ? text : `${text} Click **Join** on the announcement to be pinged when it starts.`);
}

/** Posted by the bot at the start time, pinging everyone who joined, with "Get my link". */
export function startMessage(session: Session, going: string[]): RESTPostAPIChannelMessageJSONBody {
  const text = `📖 **${headline(session)}** is starting now! Click **Get my link** to open ${describeReading(session)} in Seed Bible.`;
  return { ...pingMessage(going, text), components: [buttonRow(session, [["link", "Get my link", ButtonStyle.Primary]])] };
}

/**
 * The private reply to "Get my link": the session's Seed Bible link in the user's own language and
 * translation. With `button: false` (the server turned Seed Bible link buttons off), the address
 * is written out instead.
 */
export function personalLinkMessage(
  session: Session,
  preferences: UserPreferences,
  { locale, button }: { locale?: string; button: boolean },
): APIInteractionResponseCallbackData {
  const lang = findUiLanguage(preferences.lang ?? "")?.code ?? findUiLanguage(locale ?? "")?.code ?? "en";
  const translation = preferences.translation ?? SEED_BIBLE_DEFAULT_TRANSLATION;
  const url = seedBibleSessionUrl({
    lang,
    translation,
    book: session.bookName,
    chapter: session.chapter,
    sessionId: `session-${session.id}`,
  });
  const language = findUiLanguage(lang);
  const settings = `${translation} · Seed Bible in ${language ? describeUiLanguage(language) : lang}`;
  const text = `Your link to read **${describeReading(session)}** together (${settings}):`;
  const lines = [button ? text : `${text} ${plainLink(url)}`, "-# Change your translation or language with `/preferences`."];

  return {
    content: lines.join("\n"),
    flags: MessageFlags.Ephemeral,
    components: button
      ? [
          {
            type: ComponentType.ActionRow,
            components: [{ type: ComponentType.Button, style: ButtonStyle.Link, label: truncate(`Open ${describeReading(session)} →`, 80), url }],
          },
        ]
      : [],
    allowed_mentions: { parse: [] },
  };
}

/** "10 minutes", "1 hour", "1 day" */
export function describeMinutes(minutes: number): string {
  const unit = (n: number, name: string) => `${n} ${name}${n === 1 ? "" : "s"}`;
  if (minutes % 1440 === 0) return unit(minutes / 1440, "day");
  if (minutes % 60 === 0) return unit(minutes / 60, "hour");
  return unit(minutes, "minute");
}

function buttonRow(session: Session, buttons: [SessionAction, string, ButtonStyle.Primary | ButtonStyle.Secondary | ButtonStyle.Success | ButtonStyle.Danger][]): Row {
  return {
    type: ComponentType.ActionRow,
    components: buttons.map(([action, label, style]) => ({
      type: ComponentType.Button,
      style,
      label,
      custom_id: customId(SESSION_BUTTONS_ID, action, session.id),
    })),
  };
}

/** "<@1>, <@2> and 3 more" */
function listMentions(userIds: string[]): string {
  const shown = userIds.slice(0, MAX_LISTED).map((id) => `<@${id}>`).join(", ");
  return userIds.length > MAX_LISTED ? `${shown} and ${userIds.length - MAX_LISTED} more` : shown;
}

/** A message that starts by pinging `userIds` (at most MAX_PINGS of them), and nobody else. */
function pingMessage(userIds: string[], text: string): RESTPostAPIChannelMessageJSONBody {
  const pinged = userIds.slice(0, MAX_PINGS);
  const mentions = pinged.map((id) => `<@${id}>`).join(" ");
  const more = userIds.length > MAX_PINGS ? ` (and ${userIds.length - MAX_PINGS} more who joined)` : "";
  return {
    content: mentions ? `${mentions}${more}\n${text}` : text,
    allowed_mentions: { parse: [], users: pinged },
  };
}
