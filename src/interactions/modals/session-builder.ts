import {
  ComponentType,
  InteractionResponseType,
  TextInputStyle,
  type APIInteractionResponse,
} from "discord-api-types/v10";
import { bibleApi } from "../../bible/api.js";
import { findPassages } from "../../bible/references.js";
import { SEED_BIBLE_DEFAULT_TRANSLATION } from "../../seedbible/links.js";
import { announcementMessage } from "../../sessions/messages.js";
import { formatLocalTime, guessTimeZone } from "../../sessions/time.js";
import { addParticipant, createSession, type NewSession } from "../../storage/sessions.js";
import { userPreferences } from "../../storage/user-settings.js";
import { UserFacingError } from "../../utils/errors.js";
import { defaultLocalTime, timePickerMessage } from "../components/session-time.js";
import { deferReply } from "../deferred.js";
import { appCanPost } from "../permissions.js";
import { interactionUserId } from "../user.js";
import { choiceField, modalFields, textField } from "./fields.js";
import type { Modal } from "./types.js";

// The form /launchsession opens to plan a reading session:
//
//   Passage   "Genesis 5" (read with the same parser as inline verses)
//   Title     optional, e.g. "Wednesday Bible study"
//   When      Start now / Schedule for later
//   Reminder  for scheduled sessions: none, 15 minutes, 1 hour or 1 day before
//
// "Start now" posts the announcement with "Get my link" right away. "Schedule for later" saves a
// draft and shows the private time picker (components/session-time.ts), which posts the
// announcement once a time is chosen.

const ID = "session-builder";

/** Reminder choices, in minutes before the start (0: none). */
const REMINDERS: { minutes: number; label: string }[] = [
  { minutes: 15, label: "15 minutes before" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 1440, label: "1 day before" },
  { minutes: 0, label: "No reminder" },
];
const DEFAULT_REMINDER = 15;

/** The response that opens the form. */
export function sessionBuilderModal(): APIInteractionResponse {
  return {
    type: InteractionResponseType.Modal,
    data: {
      custom_id: ID,
      title: "Plan a reading session",
      components: [
        {
          type: ComponentType.Label,
          label: "Passage",
          description: "The chapter to read together",
          component: { type: ComponentType.TextInput, custom_id: "passage", style: TextInputStyle.Short, placeholder: "e.g. Genesis 5 or John 3", required: true, max_length: 50 },
        },
        {
          type: ComponentType.Label,
          label: "Title",
          description: "Optional",
          component: { type: ComponentType.TextInput, custom_id: "title", style: TextInputStyle.Short, placeholder: "e.g. Wednesday Bible study", required: false, max_length: 100 },
        },
        {
          type: ComponentType.Label,
          label: "When",
          component: {
            type: ComponentType.RadioGroup,
            custom_id: "when",
            required: true,
            options: [
              { value: "now", label: "Start now", default: true },
              { value: "later", label: "Schedule for later", description: "Pick a day and time next" },
            ],
          },
        },
        {
          type: ComponentType.Label,
          label: "Reminder",
          description: "For scheduled sessions: pings everyone who joined",
          component: {
            type: ComponentType.RadioGroup,
            custom_id: "reminder",
            required: false,
            options: REMINDERS.map(({ minutes, label }) => ({ value: String(minutes), label, default: minutes === DEFAULT_REMINDER })),
          },
        },
      ],
    },
  };
}

export const sessionBuilder: Modal = {
  id: ID,

  execute(interaction) {
    const guildId = interaction.guild_id;
    const channelId = interaction.channel?.id ?? interaction.channel_id;
    if (guildId === undefined || channelId === undefined) {
      throw new UserFacingError("Reading sessions are for servers, so use `/launchsession` in a server channel.");
    }

    // Everything that needs no network is checked first, so a mistake gets an instant reply.
    const fields = modalFields(interaction);
    const passageText = textField(fields, "passage") ?? "";
    const passage = findPassages(passageText)[0];
    if (!passage) {
      throw new UserFacingError(`I couldn't find a Bible chapter in "${passageText}". Try something like \`Genesis 5\` or \`John 3\`.`);
    }
    const later = choiceField(fields, "when") === "later";
    const chosenReminder = Number(choiceField(fields, "reminder") ?? DEFAULT_REMINDER);
    const reminderMinutes = REMINDERS.some((r) => r.minutes === chosenReminder) ? chosenReminder : DEFAULT_REMINDER;
    // Reminders and start messages are posted by the bot itself, later, so it must be able to.
    if (later && !appCanPost(interaction)) {
      throw new UserFacingError(
        "I can't post in this channel, so I couldn't remind anyone or ping them when the session starts. " +
          "Ask a server admin to let me **View Channel** and **Send Messages** here, or choose **Start now**.",
      );
    }

    const userId = interactionUserId(interaction);
    // Checking the chapter needs the Bible API, which may be slow on a cold cache.
    return deferReply(
      interaction,
      async () => {
        const { books } = await bibleApi.getTranslationBooks(SEED_BIBLE_DEFAULT_TRANSLATION);
        const book = books.find((b) => b.id === passage.book);
        const chapter = passage.segments[0]!.startChapter;
        if (!book) throw new UserFacingError(`Seed Bible doesn't have the book in "${passageText}".`);
        if (chapter < book.firstChapterNumber || chapter > book.lastChapterNumber) {
          throw new UserFacingError(
            book.numberOfChapters === 1
              ? `${book.commonName} has only one chapter.`
              : `${book.commonName} has chapters ${book.firstChapterNumber}–${book.lastChapterNumber}.`,
          );
        }

        const now = Math.floor(Date.now() / 1000);
        const base: Omit<NewSession, "status" | "localTime" | "timeZone" | "startAt"> = {
          guildId,
          channelId,
          creatorId: userId,
          title: textField(fields, "title") ?? null,
          book: book.id,
          bookName: book.commonName,
          chapter,
          reminderMinutes: later ? reminderMinutes : 0,
        };

        if (!later) {
          const session = await createSession({ ...base, status: "started", localTime: null, timeZone: null, startAt: now });
          await addParticipant(session.id, userId);
          console.log(`[sessions] Session ${session.id} started in guild ${guildId}`);
          return announcementMessage(session, [userId]);
        }

        const timeZone = (await userPreferences(userId)).timeZone ?? guessTimeZone(interaction.locale);
        const session = await createSession({
          ...base,
          status: "draft",
          localTime: formatLocalTime(defaultLocalTime(now, timeZone)),
          timeZone,
          startAt: null,
        });
        return timePickerMessage(session, { now });
      },
      // The time picker is only for the planner; a session starting now is announced to everyone.
      { ephemeral: later },
    );
  },
};
