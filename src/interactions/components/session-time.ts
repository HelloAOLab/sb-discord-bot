import {
  ButtonStyle,
  ComponentType,
  InteractionResponseType,
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
  type APIInteractionResponseCallbackData,
  type APIMessageComponentInteraction,
  type APISelectMenuOption,
} from "discord-api-types/v10";
import { announcementMessage, describeMinutes, describeReading } from "../../sessions/messages.js";
import {
  TIME_ZONES,
  addDays,
  describeClock,
  describeDate,
  describeHour,
  describeOffset,
  findTimeZone,
  formatLocalTime,
  fromLocalTime,
  parseLocalTime,
  toLocalTime,
  utcOffsetMinutes,
  type LocalTime,
  type TimeZoneChoice,
} from "../../sessions/time.js";
import {
  addParticipant,
  deleteDraft,
  getSession,
  participants,
  removeParticipant,
  scheduleSession,
  setDraftTime,
  unscheduleSession,
  type Session,
} from "../../storage/sessions.js";
import { setUserPreferences } from "../../storage/user-settings.js";
import { UserFacingError } from "../../utils/errors.js";
import { truncate } from "../../utils/text.js";
import { deferUpdate, sendFollowUp } from "../deferred.js";
import { interactionUserId } from "../user.js";
import { customId } from "./custom-id.js";
import { pagedOptions, pageFromValue, pageOfItem } from "./pages.js";
import type { Component } from "./types.js";

// The private time picker /launchsession shows for a session scheduled for later. Discord has no
// date or time input, so it's four menus: day (the next 25), hour, minute (5-minute steps) and
// time zone (a list, paged; the user's own from /preferences comes first if it isn't listed).
//
//   [ Day    ▾ ]  Today · Mon, Oct 12
//   [ Hour   ▾ ]  19:00 · 7 PM
//   [ Minute ▾ ]  :30
//   [ Zone   ▾ ]  Eastern Time (New York, Toronto)
//   [Schedule] [Cancel]
//
// Above the menus, the chosen time is shown as a Discord timestamp, which Discord displays in each
// viewer's own time zone: if the zone picked is wrong, the preview shows the wrong time. The
// session is a draft in the database until "Schedule"; each choice saves it and redraws the
// picker. custom_id: "session-time:<field>:<session id>:<time zone page>".
// Keep this format and the field names stable once released.

const ID = "session-time";
const FIELDS = ["day", "hour", "minute", "zone", "schedule", "cancel"] as const;
type Field = (typeof FIELDS)[number];

/** Days offered, starting today. */
const DAYS = 25;
const MINUTE_STEP = 5;
/** A session can't start sooner than this from now (Unix seconds), so its announcement comes first. */
const MIN_LEAD = 60;
/** Or later than the last day offered (only a forged custom_id can ask for one). */
const MAX_LEAD = DAYS * 24 * 60 * 60;

type ActionRow = APIActionRowComponent<APIComponentInMessageActionRow>;

/**
 * The day and time a new draft starts at: the next whole hour on the zone's clock that's at least
 * an hour away (at 10:59 that's 12:00, not 11:00), so the default reminder still has time to go out.
 */
export function defaultLocalTime(now: number, timeZone: string): LocalTime {
  // An hour from now, from the start of the next minute…
  const earliest = now + 60 * 60 + ((60 - (now % 60)) % 60);
  const local = toLocalTime(earliest, timeZone);
  // …then on to the next whole hour (in minutes, since some zones are offset by :30 or :45).
  return local.minute === 0 ? local : toLocalTime(earliest + (60 - local.minute) * 60, timeZone);
}

/** Draws the picker for a draft session. `zonePage` is the time zone menu's page (default: the chosen zone's). */
export function timePickerMessage(
  session: Session,
  { now, zonePage }: { now: number; zonePage?: number },
): APIInteractionResponseCallbackData {
  const zone = session.timeZone ?? "UTC";
  const local = parseLocalTime(session.localTime) ?? defaultLocalTime(now, zone);
  const startAt = fromLocalTime(local, zone);
  const tooSoon = startAt < now + MIN_LEAD;

  const today = toLocalTime(now, zone).date;
  const dayOptions = Array.from({ length: DAYS }, (_, i): APISelectMenuOption => {
    const date = addDays(today, i);
    const prefix = i === 0 ? "Today · " : i === 1 ? "Tomorrow · " : "";
    return { label: prefix + describeDate(date), value: date, default: date === local.date };
  });
  const hourOptions = Array.from({ length: 24 }, (_, hour): APISelectMenuOption => ({
    label: describeHour(hour),
    value: String(hour),
    default: hour === local.hour,
  }));
  const minuteOptions = Array.from({ length: 60 / MINUTE_STEP }, (_, i): APISelectMenuOption => {
    const minute = i * MINUTE_STEP;
    return { label: `:${String(minute).padStart(2, "0")}`, value: String(minute), default: minute === local.minute };
  });

  const zones: TimeZoneChoice[] = TIME_ZONES.some((z) => z.id === zone) ? TIME_ZONES : [{ id: zone, label: zone }, ...TIME_ZONES];
  const zoneOption = (z: TimeZoneChoice): APISelectMenuOption => ({
    label: truncate(z.label, 100),
    description: truncate(`${z.id} · it's ${describeClock(toLocalTime(now, z.id))} there now (${describeOffset(utcOffsetMinutes(now, z.id))})`, 100),
    value: z.id,
    default: z.id === zone,
  });
  // Only the page shown is built, since each option works out the time in its zone.
  const zoneMenu = pagedOptions(zones, zonePage ?? pageOfItem(zones.length, zones.findIndex((z) => z.id === zone)), zoneOption);

  const id = (field: Field) => customId(ID, field, session.id, zoneMenu.page);
  const rows: ActionRow[] = [
    selectRow(id("day"), "Day", dayOptions),
    selectRow(id("hour"), "Hour", hourOptions),
    selectRow(id("minute"), "Minute", minuteOptions),
    selectRow(id("zone"), zoneMenu.pageCount > 1 ? `Time zone (page ${zoneMenu.page + 1} of ${zoneMenu.pageCount})` : "Time zone", zoneMenu.options),
    {
      type: ComponentType.ActionRow,
      components: [
        { type: ComponentType.Button, style: ButtonStyle.Success, label: "Schedule", custom_id: id("schedule"), disabled: tooSoon },
        { type: ComponentType.Button, style: ButtonStyle.Secondary, label: "Cancel", custom_id: id("cancel") },
      ],
    },
  ];

  const zoneLabel = zones.find((z) => z.id === zone)?.label ?? zone;
  const lines = [
    `**When should we read ${describeReading(session)} together?**`,
    `🗓️ **<t:${startAt}:F>** (<t:${startAt}:R>)`,
    tooSoon
      ? "⚠️ That time has already passed. Pick a later day or time."
      : "-# Discord shows this time in your own time zone. If it looks wrong, change the time zone below.",
    `-# Picked: ${describeDate(local.date)} at ${describeClock(local)}, ${zoneLabel} time. ${describeReminder(session, startAt, now)}`,
  ];
  return { content: lines.join("\n"), components: rows, allowed_mentions: { parse: [] } };
}

export const sessionTime: Component = {
  id: ID,

  async execute(interaction, [field = "", sessionId = "", zonePage = ""]) {
    if (!(FIELDS as readonly string[]).includes(field)) {
      throw new UserFacingError("This menu no longer works. Please run `/launchsession` again.");
    }
    const session = await getSession(sessionId);
    if (!session) throw new UserFacingError("This time picker has expired. Please run `/launchsession` again.");
    if (session.status !== "draft") throw new UserFacingError("This session has already been scheduled or cancelled.");
    const userId = interactionUserId(interaction);
    // The picker is private, but anyone can send any custom_id.
    if (session.creatorId !== userId) throw new UserFacingError("Only the person planning this session can change its time.");

    const now = Math.floor(Date.now() / 1000);
    const zone = session.timeZone ?? "UTC";
    const local = parseLocalTime(session.localTime) ?? defaultLocalTime(now, zone);
    const page = toPage(zonePage);

    if (field === "cancel") {
      await deleteDraft(session.id);
      return update({ content: "Cancelled. Nothing was posted.", components: [], allowed_mentions: { parse: [] } });
    }
    if (field === "schedule") return schedule(interaction, session, local, zone, now);

    const value = selectedValue(interaction);
    if (value === undefined) throw new UserFacingError("This menu no longer works. Please run `/launchsession` again.");

    const next: { local: LocalTime; zone: string; page: number | undefined } = { local, zone, page };
    if (field === "day" && /^\d{4}-\d{2}-\d{2}$/.test(value)) next.local = { ...local, date: value };
    if (field === "hour" && isInRange(value, 0, 23)) next.local = { ...local, hour: Number(value) };
    if (field === "minute" && isInRange(value, 0, 59)) next.local = { ...local, minute: Number(value) };
    if (field === "zone") {
      const newPage = pageFromValue(value);
      const newZone = newPage === undefined ? findTimeZone(value) : null;
      if (newPage !== undefined) {
        next.page = newPage;
      } else if (newZone) {
        // Same clock time in the new zone. The menu shows the page the new zone is on.
        next.zone = newZone;
        next.page = undefined;
      }
    }

    const localTime = formatLocalTime(next.local);
    await setDraftTime(session.id, localTime, next.zone);
    return update(timePickerMessage({ ...session, localTime, timeZone: next.zone }, { now, zonePage: next.page }));
  },
};

/**
 * Books the session, posts its public announcement, and closes the picker. The planner joins it
 * and their time zone is remembered for next time. If the announcement can't be posted, the
 * booking is undone, so nothing is left scheduled that nobody can see, and Schedule works again.
 */
async function schedule(interaction: APIMessageComponentInteraction, session: Session, local: LocalTime, zone: string, now: number) {
  const startAt = fromLocalTime(local, zone);
  if (startAt < now + MIN_LEAD) throw new UserFacingError("That time has already passed. Pick a later day or time.");
  if (startAt > now + MAX_LEAD) throw new UserFacingError(`Sessions can be scheduled up to ${DAYS} days ahead.`);

  // A reminder whose time has already passed (a 1-day reminder for tonight) isn't sent.
  const reminderSent = session.reminderMinutes === 0 || reminderPassed(session, startAt, now);
  // Booked first, so two clicks on Schedule can't post two announcements.
  if (!(await scheduleSession(session.id, startAt, { reminderSent }))) {
    throw new UserFacingError("This session has already been scheduled or cancelled.");
  }
  const scheduled: Session = { ...session, status: "scheduled", startAt, reminderSent };

  return deferUpdate(interaction, async () => {
    try {
      await addParticipant(session.id, session.creatorId);
      await sendFollowUp(interaction, announcementMessage(scheduled, await participants(session.id)));
    } catch (error) {
      console.error(`[sessions] Couldn't post the announcement for session ${session.id}:`, error);
      await unscheduleSession(session.id);
      await removeParticipant(session.id, session.creatorId);
      throw new UserFacingError("I couldn't post the announcement in this channel, so nothing was scheduled. Please click **Schedule** again.");
    }
    try {
      await setUserPreferences(session.creatorId, { timeZone: zone });
    } catch (error) {
      // Only a convenience for next time; the session is booked either way.
      console.error(`[sessions] Couldn't remember the time zone of user ${session.creatorId}:`, error);
    }
    return {
      content: `✅ Scheduled for <t:${startAt}:F>. I posted the announcement below: people click **Join** there to be pinged when it starts.`,
      components: [],
      allowed_mentions: { parse: [] },
    };
  });
}

/** Whether the session's reminder time is already past at `now`. */
function reminderPassed(session: Session, startAt: number, now: number): boolean {
  return startAt - session.reminderMinutes * 60 <= now;
}

/** "Reminder 15 minutes before.", "No reminder.", or why the reminder won't be sent. */
function describeReminder(session: Session, startAt: number, now: number): string {
  if (session.reminderMinutes === 0) return "No reminder.";
  const before = describeMinutes(session.reminderMinutes);
  return reminderPassed(session, startAt, now)
    ? `No reminder: ${before} before this time has already passed.`
    : `Reminder ${before} before.`;
}

const update = (data: APIInteractionResponseCallbackData) => ({ type: InteractionResponseType.UpdateMessage, data }) as const;

function selectedValue(interaction: APIMessageComponentInteraction): string | undefined {
  return interaction.data.component_type === ComponentType.StringSelect ? interaction.data.values[0] : undefined;
}

function isInRange(text: string, min: number, max: number): boolean {
  const n = Number(text);
  return /^\d+$/.test(text) && n >= min && n <= max;
}

/** A page number from a custom_id; anything garbled means "the chosen zone's page". */
function toPage(text: string): number | undefined {
  const page = Number.parseInt(text, 10);
  return Number.isInteger(page) && page >= 0 ? page : undefined;
}

function selectRow(customId: string, placeholder: string, options: APISelectMenuOption[]): ActionRow {
  return {
    type: ComponentType.ActionRow,
    components: [{ type: ComponentType.StringSelect, custom_id: customId, placeholder, options }],
  };
}
