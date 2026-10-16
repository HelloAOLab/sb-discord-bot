import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComponentType, InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { components } from "../../../src/interactions/components/index.js";
import { customId, parseCustomId } from "../../../src/interactions/components/custom-id.js";
import { defaultLocalTime, sessionTime, timePickerMessage } from "../../../src/interactions/components/session-time.js";
import { runDeferredWork } from "../../../src/interactions/deferred.js";
import { database } from "../../../src/storage/database.js";
import { getSession, participants, type Session } from "../../../src/storage/sessions.js";
import { userPreferences } from "../../../src/storage/user-settings.js";
import { UserFacingError } from "../../../src/utils/errors.js";
import { mockFetch } from "../../helpers/bible-api.js";
import { buttonInteraction, selectInteraction } from "../../helpers/interactions.js";
import { fromLocalTime } from "../../../src/sessions/time.js";
import { NOW, TEST_USER, saveSession } from "../../helpers/sessions.js";

type Message = ReturnType<typeof timePickerMessage>;
interface Menu {
  custom_id: string;
  placeholder: string;
  options: { label: string; value: string; default?: boolean; description?: string }[];
}

/** A draft for Genesis 5 at 19:00 on Wed 14 Oct, New York time (23:00 UTC). */
const draft = (overrides: Partial<Session> = {}) =>
  saveSession({ status: "draft", localTime: "2026-10-14T19:00", timeZone: "America/New_York", startAt: null, ...overrides });

const START = Date.UTC(2026, 9, 14, 23, 0) / 1000;

/** The select menus in the picker, keyed by field ("day", "hour", "minute", "zone"). */
function menus(message: Message): Record<string, Menu> {
  const found: Record<string, Menu> = {};
  for (const row of message.components ?? []) {
    for (const component of (row as any).components) {
      if (component.type === ComponentType.StringSelect) found[parseCustomId(component.custom_id).args[0]!] = component;
    }
  }
  return found;
}
const buttons = (message: Message) => (message.components!.at(-1) as any).components;
const selected = (menu: Menu) => menu.options.find((o) => o.default)?.value;

/** Picks `value` in the picker's menu for `field` and returns the redrawn picker. */
async function choose(session: Session, field: string, value: string, zonePage = 0): Promise<Message> {
  const id = customId("session-time", field, session.id, zonePage);
  const response = await sessionTime.execute(selectInteraction(id, [value]), parseCustomId(id).args);
  expect(response.type).toBe(InteractionResponseType.UpdateMessage);
  return (response as any).data;
}

function click(session: Session, field: "schedule" | "cancel", overrides = {}) {
  const id = customId("session-time", field, session.id, 0);
  return sessionTime.execute(buttonInteraction(id, overrides), parseCustomId(id).args);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000);
});
afterEach(() => vi.useRealTimers());

describe("timePickerMessage", () => {
  it("previews the chosen time as a Discord timestamp, shown in each viewer's own time zone", async () => {
    const message = timePickerMessage(await draft(), { now: NOW });
    expect(message.content).toBe(
      [
        "**When should we read Genesis 5 together?**",
        `🗓️ **<t:${START}:F>** (<t:${START}:R>)`,
        "-# Discord shows this time in your own time zone. If it looks wrong, change the time zone below.",
        "-# Picked: Wed, Oct 14 at 19:00, Eastern Time (New York, Toronto) time. Reminder 15 minutes before.",
      ].join("\n"),
    );
  });

  it("has day, hour, minute and time zone menus wired to this component, then Schedule and Cancel", async () => {
    const session = await draft();
    const message = timePickerMessage(session, { now: NOW });
    expect(message.components).toHaveLength(5);

    const { day, hour, minute, zone } = menus(message);
    for (const menu of [day, hour, minute, zone]) {
      const { id, args } = parseCustomId(menu!.custom_id);
      expect(components.get(id)).toBe(sessionTime);
      expect(args[1]).toBe(session.id);
    }
    expect(buttons(message).map((b: any) => [b.label, parseCustomId(b.custom_id).args[0], b.disabled])).toEqual([
      ["Schedule", "schedule", false],
      ["Cancel", "cancel", undefined],
    ]);
  });

  it("offers the next 25 days in the chosen time zone, with the picked one selected", async () => {
    const { day } = menus(timePickerMessage(await draft(), { now: NOW }));
    expect(day!.options).toHaveLength(25);
    expect(day!.options.slice(0, 3).map((o) => o.label)).toEqual(["Today · Mon, Oct 12", "Tomorrow · Tue, Oct 13", "Wed, Oct 14"]);
    expect(selected(day!)).toBe("2026-10-14");
  });

  it("starts the day list at the zone's own today", async () => {
    // 12:00 UTC on the 12th is already the 13th in Auckland.
    const { day } = menus(timePickerMessage(await draft({ timeZone: "Pacific/Auckland" }), { now: NOW }));
    expect(day!.options[0]!.label).toBe("Today · Tue, Oct 13");
  });

  it("offers every hour and 5-minute steps", async () => {
    const { hour, minute } = menus(timePickerMessage(await draft({ localTime: "2026-10-14T07:35" }), { now: NOW }));
    expect(hour!.options).toHaveLength(24);
    expect(selected(hour!)).toBe("7");
    expect(minute!.options.map((o) => o.label)).toEqual([":00", ":05", ":10", ":15", ":20", ":25", ":30", ":35", ":40", ":45", ":50", ":55"]);
    expect(selected(minute!)).toBe("35");
  });

  it("shows the time zone's page, and the time there now in each option", async () => {
    const { zone } = menus(timePickerMessage(await draft({ timeZone: "Asia/Tokyo" }), { now: NOW }));
    expect(zone!.placeholder).toBe("Time zone (page 2 of 2)");
    expect(zone!.options.find((o) => o.value === "Asia/Tokyo")).toEqual({
      label: "Tokyo",
      description: "Asia/Tokyo · it's 21:00 there now (UTC+9)",
      value: "Asia/Tokyo",
      default: true,
    });
  });

  it("lists a time zone saved with /preferences first when it isn't in the list", async () => {
    const { zone } = menus(timePickerMessage(await draft({ timeZone: "Europe/Vienna" }), { now: NOW }));
    expect(zone!.options[0]).toMatchObject({ label: "Europe/Vienna", value: "Europe/Vienna", default: true });
  });

  it("warns about a time that has passed and disables Schedule", async () => {
    const message = timePickerMessage(await draft({ localTime: "2026-10-12T07:00" }), { now: NOW });
    expect(message.content).toContain("⚠️ That time has already passed.");
    expect(buttons(message)[0].disabled).toBe(true);
  });
});

describe("time picker choices", () => {
  it("changes the day, hour and minute, keeping the rest", async () => {
    const session = await draft();
    await choose(session, "day", "2026-10-20");
    await choose(session, "hour", "6");
    const message = await choose(session, "minute", "45");

    expect((await getSession(session.id))!.localTime).toBe("2026-10-20T06:45");
    expect(message.content).toContain(`<t:${Date.UTC(2026, 9, 20, 10, 45) / 1000}:F>`);
  });

  it("keeps the clock time when the time zone changes", async () => {
    const session = await draft();
    const message = await choose(session, "zone", "Europe/London");
    expect(await getSession(session.id)).toMatchObject({ localTime: "2026-10-14T19:00", timeZone: "Europe/London" });
    expect(message.content).toContain(`<t:${Date.UTC(2026, 9, 14, 18, 0) / 1000}:F>`);
    expect(selected(menus(message).zone!)).toBe("Europe/London");
  });

  it("pages through the time zones without changing the time", async () => {
    const session = await draft();
    const message = await choose(session, "zone", "page:1");
    expect(menus(message).zone!.placeholder).toBe("Time zone (page 2 of 2)");
    expect(parseCustomId(menus(message).day!.custom_id).args).toEqual(["day", session.id, "1"]);
    expect((await getSession(session.id))!.timeZone).toBe("America/New_York");
  });

  it("stays on the page shown while other menus change", async () => {
    const session = await draft();
    const message = await choose(session, "hour", "8", 1);
    expect(menus(message).zone!.placeholder).toBe("Time zone (page 2 of 2)");
  });

  it("ignores garbled values", async () => {
    const session = await draft();
    await choose(session, "hour", "25");
    await choose(session, "minute", "-5");
    await choose(session, "day", "tomorrow");
    await choose(session, "zone", "Mars/Base");
    expect(await getSession(session.id)).toMatchObject({ localTime: "2026-10-14T19:00", timeZone: "America/New_York" });
  });

  it("lets only the planner change it", async () => {
    const session = await draft({ creatorId: "someone-else" });
    const id = customId("session-time", "hour", session.id, 0);
    await expect(sessionTime.execute(selectInteraction(id, ["8"]), parseCustomId(id).args)).rejects.toThrow(
      new UserFacingError("Only the person planning this session can change its time."),
    );
  });

  it("explains an expired picker or a forged custom_id", async () => {
    await expect(sessionTime.execute(selectInteraction("x", ["8"]), ["hour", "missing", "0"])).rejects.toThrow(/expired/);
    await expect(sessionTime.execute(selectInteraction("x", ["8"]), ["bogus", "missing"])).rejects.toThrow(/no longer works/);
    const scheduled = await saveSession();
    await expect(sessionTime.execute(selectInteraction("x", ["8"]), ["hour", scheduled.id, "0"])).rejects.toThrow(/already been scheduled/);
  });
});

describe("Schedule", () => {
  it("books the session, posts the public announcement, and closes the picker", async () => {
    const session = await draft();
    const { discordCalls } = mockFetch();

    const response = await click(session, "schedule");
    expect(response).toEqual({ type: InteractionResponseType.DeferredMessageUpdate });
    await runDeferredWork(response);

    expect(await getSession(session.id)).toMatchObject({ status: "scheduled", startAt: START, reminderSent: false });
    // The planner is going, and their time zone is remembered.
    expect(await participants(session.id)).toEqual([TEST_USER]);
    expect(await userPreferences(TEST_USER)).toEqual({ timeZone: "America/New_York" });

    expect(discordCalls.map((c) => c.method)).toEqual(["POST", "PATCH"]);
    const [announcement, picker] = discordCalls.map((c) => c.body);
    expect(announcement.flags).toBeUndefined();
    expect(announcement.content).toContain(`🗓️ Starts <t:${START}:F>`);
    expect(announcement.content).toContain(`👥 Going (1): <@${TEST_USER}>`);
    expect(announcement.allowed_mentions).toEqual({ parse: [] });
    expect(picker).toEqual({
      content: `✅ Scheduled for <t:${START}:F>. I posted the announcement below: people click **Join** there to be pinged when it starts.`,
      components: [],
      allowed_mentions: { parse: [] },
    });
  });

  it("skips a reminder whose time has already passed", async () => {
    const session = await draft({ localTime: "2026-10-12T08:30", reminderMinutes: 60 }); // 12:30 UTC, 30 minutes away
    mockFetch();
    await runDeferredWork(await click(session, "schedule"));
    expect((await getSession(session.id))!.reminderSent).toBe(true);
  });

  it("refuses a time that has passed", async () => {
    const session = await draft({ localTime: "2026-10-12T07:00" });
    await expect(click(session, "schedule")).rejects.toThrow(new UserFacingError("That time has already passed. Pick a later day or time."));
    expect((await getSession(session.id))!.status).toBe("draft");
  });

  it("undoes the booking if the announcement can't be posted, so Schedule works again", async () => {
    const session = await draft();
    const { discordCalls } = mockFetch({ discordStatus: 403 });
    vi.spyOn(console, "error").mockImplementation(() => {});

    await runDeferredWork(await click(session, "schedule"));

    expect(await getSession(session.id)).toMatchObject({ status: "draft", startAt: null, localTime: session.localTime });
    expect(await participants(session.id)).toEqual([]);
    // The picker stays open, with a private explanation.
    expect(discordCalls.map((c) => c.method)).toEqual(["POST", "POST"]);
    expect(discordCalls[1]!.body).toMatchObject({ content: expect.stringContaining("nothing was scheduled"), flags: MessageFlags.Ephemeral });

    // Trying again works once Discord accepts the announcement.
    const retry = mockFetch();
    await runDeferredWork(await click(session, "schedule"));
    expect((await getSession(session.id))!.status).toBe("scheduled");
    expect(retry.discordCalls.map((c) => c.method)).toEqual(["POST", "PATCH"]);
  });

  it("undoes the booking if the database fails halfway, leaving no hidden session", async () => {
    const session = await draft();
    const { discordCalls } = mockFetch();
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Adding the planner to the session fails.
    const db = database();
    const prepare = db.prepare.bind(db);
    vi.spyOn(db, "prepare").mockImplementation((sql) => {
      if (sql.includes("INSERT OR IGNORE INTO session_participants")) throw new Error("D1 is down");
      return prepare(sql);
    });

    await runDeferredWork(await click(session, "schedule"));

    expect((await getSession(session.id))!.status).toBe("draft");
    expect(discordCalls.map((c) => c.method)).toEqual(["POST"]); // only the private error, no announcement
  });

  it("can't book the same session twice", async () => {
    const session = await draft();
    mockFetch();
    await runDeferredWork(await click(session, "schedule"));
    await expect(click(session, "schedule")).rejects.toThrow(/already been scheduled/);
  });
});

describe("defaultLocalTime", () => {
  const at = (iso: string) => Date.parse(iso) / 1000;

  it("is the next whole hour at least an hour away", () => {
    expect(defaultLocalTime(at("2026-10-12T10:00:00Z"), "UTC")).toEqual({ date: "2026-10-12", hour: 11, minute: 0 });
    expect(defaultLocalTime(at("2026-10-12T10:20:00Z"), "UTC")).toEqual({ date: "2026-10-12", hour: 12, minute: 0 });
    // Not 11:00, which would be under a minute away.
    expect(defaultLocalTime(at("2026-10-12T10:59:30Z"), "UTC")).toEqual({ date: "2026-10-12", hour: 12, minute: 0 });
    expect(defaultLocalTime(at("2026-10-12T23:30:00Z"), "UTC")).toEqual({ date: "2026-10-13", hour: 1, minute: 0 });
  });

  it("uses the zone's own clock, even in zones offset by half an hour", () => {
    // 10:00 UTC is 15:30 in India: the next whole hour an hour away there is 17:00.
    expect(defaultLocalTime(at("2026-10-12T10:00:00Z"), "Asia/Kolkata")).toEqual({ date: "2026-10-12", hour: 17, minute: 0 });
  });

  it("always leaves at least an hour, so the default reminder can go out", () => {
    for (let now = NOW; now < NOW + 2 * 60 * 60; now += 7 * 60 + 13) {
      for (const zone of ["UTC", "Asia/Kolkata", "Asia/Kathmandu", "America/New_York"]) {
        const startAt = fromLocalTime(defaultLocalTime(now, zone), zone);
        expect(startAt - now).toBeGreaterThanOrEqual(60 * 60);
        expect(startAt - now).toBeLessThanOrEqual(2 * 60 * 60);
      }
    }
  });
});

describe("reminders and limits", () => {
  it("says when the reminder's time has already passed, instead of dropping it silently", async () => {
    // 12:30 UTC, half an hour from NOW, with a 1-hour reminder.
    const message = timePickerMessage(await draft({ localTime: "2026-10-12T08:30", reminderMinutes: 60 }), { now: NOW });
    expect(message.content).toContain("No reminder: 1 hour before this time has already passed.");
  });

  it("refuses a day beyond the ones offered (only a forged custom_id can ask)", async () => {
    const session = await draft({ localTime: "2026-12-25T19:00" });
    await expect(click(session, "schedule")).rejects.toThrow(new UserFacingError("Sessions can be scheduled up to 25 days ahead."));
  });
});

describe("Cancel", () => {
  it("deletes the draft and closes the picker without posting anything", async () => {
    const session = await draft();
    const response = await click(session, "cancel");
    expect(response).toEqual({
      type: InteractionResponseType.UpdateMessage,
      data: { content: "Cancelled. Nothing was posted.", components: [], allowed_mentions: { parse: [] } },
    });
    expect(await getSession(session.id)).toBeNull();
  });
});
