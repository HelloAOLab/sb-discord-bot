import { describe, expect, it } from "vitest";
import { database } from "../../src/storage/database.js";
import {
  addParticipant,
  cancelSession,
  deleteDraft,
  deleteOldSessions,
  deleteStaleDrafts,
  dueReminders,
  dueStarts,
  getSession,
  markReminderSent,
  markStarted,
  participants,
  removeParticipant,
  scheduleSession,
  setDraftTime,
  unscheduleSession,
} from "../../src/storage/sessions.js";
import { setUserPreferences, userPreferences } from "../../src/storage/user-settings.js";
import { NOW, saveSession } from "../helpers/sessions.js";

describe("sessions", () => {
  it("saves a session with a new random ID and reads it back", async () => {
    const saved = await saveSession({ title: "Wednesday study" });
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await getSession(saved.id)).toEqual(saved);
    expect((await saveSession()).id).not.toBe(saved.id);
  });

  it("returns null for a session that doesn't exist", async () => {
    expect(await getSession("nope")).toBeNull();
  });

  it("changes a draft's time, and schedules it only once", async () => {
    const draft = await saveSession({ status: "draft", startAt: null });
    await setDraftTime(draft.id, "2026-10-14T19:00", "Europe/London");

    expect(await scheduleSession(draft.id, NOW + 100, { reminderSent: false })).toBe(true);
    expect(await scheduleSession(draft.id, NOW + 200, { reminderSent: false })).toBe(false);
    expect(await getSession(draft.id)).toMatchObject({
      status: "scheduled",
      localTime: "2026-10-14T19:00",
      timeZone: "Europe/London",
      startAt: NOW + 100,
      reminderSent: false,
    });
  });

  it("doesn't change the time of a session that's already scheduled", async () => {
    const session = await saveSession();
    await setDraftTime(session.id, "2030-01-01T00:00", "UTC");
    expect((await getSession(session.id))!.localTime).toBe(session.localTime);
  });

  it("starts a scheduled session once", async () => {
    const session = await saveSession();
    expect(await markStarted(session.id)).toBe(true);
    expect(await markStarted(session.id)).toBe(false);
    expect((await getSession(session.id))!.status).toBe("started");
  });

  it("cancels a session only before it starts", async () => {
    const scheduled = await saveSession();
    expect(await cancelSession(scheduled.id)).toBe(true);
    expect(await cancelSession(scheduled.id)).toBe(false);
    expect(await markStarted(scheduled.id)).toBe(false);

    const started = await saveSession({ status: "started" });
    expect(await cancelSession(started.id)).toBe(false);
  });

  it("deletes only drafts", async () => {
    const draft = await saveSession({ status: "draft" });
    const scheduled = await saveSession();
    await deleteDraft(draft.id);
    await deleteDraft(scheduled.id);
    expect(await getSession(draft.id)).toBeNull();
    expect(await getSession(scheduled.id)).not.toBeNull();
  });

  it("deletes drafts left since before a time, keeping newer ones and booked sessions", async () => {
    const old = await saveSession({ status: "draft" });
    const fresh = await saveSession({ status: "draft" });
    const scheduled = await saveSession();
    await database().prepare("UPDATE sessions SET created_at = '2026-10-10 12:00:00' WHERE id IN (?, ?)").bind(old.id, scheduled.id).run();
    await database().prepare("UPDATE sessions SET created_at = '2026-10-12 11:00:00' WHERE id = ?").bind(fresh.id).run();

    await deleteStaleDrafts(NOW - 24 * 60 * 60);

    expect(await getSession(old.id)).toBeNull();
    expect(await getSession(fresh.id)).not.toBeNull();
    expect(await getSession(scheduled.id)).not.toBeNull();
  });
});

describe("cleaning up", () => {
  it("undoes a booking, making the session a draft again", async () => {
    const draft = await saveSession({ status: "draft", startAt: null });
    await scheduleSession(draft.id, NOW + 100, { reminderSent: true });
    await unscheduleSession(draft.id);
    expect(await getSession(draft.id)).toMatchObject({ status: "draft", startAt: null, reminderSent: false });
    expect(await scheduleSession(draft.id, NOW + 200, { reminderSent: false })).toBe(true);
  });

  it("only undoes a booking that hasn't started", async () => {
    const started = await saveSession({ status: "started" });
    await unscheduleSession(started.id);
    expect((await getSession(started.id))!.status).toBe("started");
  });

  it("deletes sessions that started or were cancelled long ago, with who joined them", async () => {
    const oldStarted = await saveSession({ status: "started", startAt: NOW - 100 });
    const oldCancelled = await saveSession({ status: "cancelled", startAt: NOW - 100 });
    const recent = await saveSession({ status: "started", startAt: NOW });
    const late = await saveSession({ status: "scheduled", startAt: NOW - 100 });
    for (const session of [oldStarted, recent]) await addParticipant(session.id, "a");

    await deleteOldSessions(NOW - 50);

    expect(await getSession(oldStarted.id)).toBeNull();
    expect(await getSession(oldCancelled.id)).toBeNull();
    expect(await participants(oldStarted.id)).toEqual([]);
    expect(await getSession(recent.id)).not.toBeNull();
    expect(await participants(recent.id)).toEqual(["a"]);
    // Not started yet (the cron is late): kept, so it still starts.
    expect(await getSession(late.id)).not.toBeNull();
  });
});

describe("due sessions", () => {
  it("finds reminders from their reminder time until the start", async () => {
    const session = await saveSession({ startAt: NOW + 15 * 60, reminderMinutes: 15 });
    expect(await dueReminders(NOW - 1)).toEqual([]);
    expect((await dueReminders(NOW)).map((s) => s.id)).toEqual([session.id]);
    expect((await dueReminders(NOW + 15 * 60 - 1)).map((s) => s.id)).toEqual([session.id]);
    expect(await dueReminders(NOW + 15 * 60)).toEqual([]);
  });

  it("skips reminders already sent, sessions without one, and sessions not scheduled", async () => {
    const sent = await saveSession({ startAt: NOW + 60 });
    expect(await markReminderSent(sent.id)).toBe(true);
    expect(await markReminderSent(sent.id)).toBe(false);
    await saveSession({ startAt: NOW + 60, reminderMinutes: 0 });
    await saveSession({ startAt: NOW + 60, status: "cancelled" });
    await saveSession({ startAt: NOW + 60, status: "draft" });
    expect(await dueReminders(NOW)).toEqual([]);
  });

  it("finds scheduled sessions whose start time has come, earliest first", async () => {
    const later = await saveSession({ startAt: NOW });
    const earlier = await saveSession({ startAt: NOW - 120 });
    await saveSession({ startAt: NOW + 1 });
    await saveSession({ startAt: NOW - 60, status: "started" });
    await saveSession({ startAt: NOW - 60, status: "cancelled" });
    expect((await dueStarts(NOW)).map((s) => s.id)).toEqual([earlier.id, later.id]);
  });
});

describe("participants", () => {
  it("lists people in the order they joined, each once", async () => {
    const { id } = await saveSession();
    expect(await addParticipant(id, "b")).toBe(true);
    expect(await addParticipant(id, "a")).toBe(true);
    expect(await addParticipant(id, "b")).toBe(false);
    expect(await participants(id)).toEqual(["b", "a"]);
  });

  it("removes someone who leaves", async () => {
    const { id } = await saveSession();
    await addParticipant(id, "a");
    expect(await removeParticipant(id, "a")).toBe(true);
    expect(await removeParticipant(id, "a")).toBe(false);
    expect(await participants(id)).toEqual([]);
  });

  it("keeps each session's people separate", async () => {
    const first = await saveSession();
    const second = await saveSession();
    await addParticipant(first.id, "a");
    expect(await participants(second.id)).toEqual([]);
  });
});

describe("user preferences", () => {
  it("are empty until set", async () => {
    expect(await userPreferences("u")).toEqual({});
  });

  it("are saved, changed in place, and forgotten with null", async () => {
    await setUserPreferences("u", { translation: "BSB", lang: "es", timeZone: "Asia/Tokyo" });
    await setUserPreferences("u", { lang: "fr" });
    expect(await userPreferences("u")).toEqual({ translation: "BSB", lang: "fr", timeZone: "Asia/Tokyo" });

    await setUserPreferences("u", { translation: null });
    expect(await userPreferences("u")).toEqual({ lang: "fr", timeZone: "Asia/Tokyo" });
    const { results } = await database().prepare("SELECT name FROM user_settings WHERE user_id = 'u' ORDER BY name").all();
    expect(results).toEqual([{ name: "lang" }, { name: "time_zone" }]);
  });

  it("are separate for each user", async () => {
    await setUserPreferences("u", { lang: "es" });
    expect(await userPreferences("v")).toEqual({});
  });
});
