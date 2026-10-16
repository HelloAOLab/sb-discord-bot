import { database } from "./database.js";

// Reading sessions planned with /launchsession, and who joined them (see src/sessions/ and the
// sessions table in migrations/0002_create_sessions.sql). Times are Unix seconds.

export type SessionStatus = "draft" | "scheduled" | "started" | "cancelled";

export interface Session {
  /** Random UUID. The Seed Bible session is "session-<id>". */
  id: string;
  guildId: string;
  channelId: string;
  creatorId: string;
  title: string | null;
  /** USFM book code, e.g. "GEN". */
  book: string;
  /** The book's English name, e.g. "Genesis": Seed Bible's links use it. */
  bookName: string;
  chapter: number;
  status: SessionStatus;
  /** The day and time picked, on the clock in `timeZone` ("2026-10-14T19:00"). */
  localTime: string | null;
  timeZone: string | null;
  startAt: number | null;
  /** 0 for no reminder. */
  reminderMinutes: number;
  reminderSent: boolean;
}

interface SessionRow {
  id: string;
  guild_id: string;
  channel_id: string;
  creator_id: string;
  title: string | null;
  book: string;
  book_name: string;
  chapter: number;
  status: SessionStatus;
  local_time: string | null;
  time_zone: string | null;
  start_at: number | null;
  reminder_minutes: number;
  reminder_sent: number;
}

const fromRow = (row: SessionRow): Session => ({
  id: row.id,
  guildId: row.guild_id,
  channelId: row.channel_id,
  creatorId: row.creator_id,
  title: row.title,
  book: row.book,
  bookName: row.book_name,
  chapter: row.chapter,
  status: row.status,
  localTime: row.local_time,
  timeZone: row.time_zone,
  startAt: row.start_at,
  reminderMinutes: row.reminder_minutes,
  reminderSent: row.reminder_sent !== 0,
});

export type NewSession = Omit<Session, "id" | "reminderSent">;

/** Saves a new session and returns it with its new ID. */
export async function createSession(input: NewSession): Promise<Session> {
  const session: Session = { ...input, id: crypto.randomUUID(), reminderSent: false };
  await database()
    .prepare(`
      INSERT INTO sessions (id, guild_id, channel_id, creator_id, title, book, book_name, chapter, status,
                            local_time, time_zone, start_at, reminder_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      session.id,
      session.guildId,
      session.channelId,
      session.creatorId,
      session.title,
      session.book,
      session.bookName,
      session.chapter,
      session.status,
      session.localTime,
      session.timeZone,
      session.startAt,
      session.reminderMinutes,
    )
    .run();
  return session;
}

export async function getSession(id: string): Promise<Session | null> {
  const row = await database().prepare("SELECT * FROM sessions WHERE id = ?").bind(id).first<SessionRow>();
  return row ? fromRow(row) : null;
}

/** Changes the day, time or time zone of a session still being planned. */
export async function setDraftTime(id: string, localTime: string, timeZone: string): Promise<void> {
  await database()
    .prepare("UPDATE sessions SET local_time = ?, time_zone = ? WHERE id = ? AND status = 'draft'")
    .bind(localTime, timeZone, id)
    .run();
}

/**
 * Books a session being planned for `startAt`. With `reminderSent`, no reminder goes out (its time
 * has already passed). Returns false if it wasn't a draft any more (scheduled twice, cancelled).
 */
export async function scheduleSession(id: string, startAt: number, { reminderSent }: { reminderSent: boolean }): Promise<boolean> {
  return changed(
    database()
      .prepare("UPDATE sessions SET status = 'scheduled', start_at = ?, reminder_sent = ? WHERE id = ? AND status = 'draft'")
      .bind(startAt, reminderSent ? 1 : 0, id),
  );
}

/**
 * Undoes scheduleSession(): the session is a draft again, so its time picker can try again.
 * Used when booking fails halfway (the announcement couldn't be posted).
 */
export async function unscheduleSession(id: string): Promise<void> {
  await database()
    .prepare("UPDATE sessions SET status = 'draft', start_at = NULL, reminder_sent = 0 WHERE id = ? AND status = 'scheduled'")
    .bind(id)
    .run();
}

/** Marks a scheduled session as started. Returns false if it wasn't scheduled (already started, cancelled). */
export async function markStarted(id: string): Promise<boolean> {
  return changed(
    database().prepare("UPDATE sessions SET status = 'started' WHERE id = ? AND status = 'scheduled'").bind(id),
  );
}

/** Returns false if the reminder was already marked sent. */
export async function markReminderSent(id: string): Promise<boolean> {
  return changed(database().prepare("UPDATE sessions SET reminder_sent = 1 WHERE id = ? AND reminder_sent = 0").bind(id));
}

/** Cancels a session that hasn't started. Returns false if it had (or was already cancelled). */
export async function cancelSession(id: string): Promise<boolean> {
  return changed(
    database()
      .prepare("UPDATE sessions SET status = 'cancelled' WHERE id = ? AND status IN ('draft', 'scheduled')")
      .bind(id),
  );
}

/** Deletes a session being planned (the planner cancelled the time picker). */
export async function deleteDraft(id: string): Promise<void> {
  await database().prepare("DELETE FROM sessions WHERE id = ? AND status = 'draft'").bind(id).run();
}

/** Deletes sessions left in planning since before `before` (time pickers abandoned). */
export async function deleteStaleDrafts(before: number): Promise<void> {
  const cutoff = new Date(before * 1000).toISOString().slice(0, 19).replace("T", " ");
  await database().prepare("DELETE FROM sessions WHERE status = 'draft' AND created_at < ?").bind(cutoff).run();
}

/**
 * Deletes sessions that started or were cancelled before `before`, with the list of who joined
 * them. Their buttons then say the session no longer exists.
 */
export async function deleteOldSessions(before: number): Promise<void> {
  const old = "SELECT id FROM sessions WHERE status IN ('started', 'cancelled') AND start_at < ?";
  await database().prepare(`DELETE FROM session_participants WHERE session_id IN (${old})`).bind(before).run();
  await database().prepare(`DELETE FROM sessions WHERE id IN (${old})`).bind(before).run();
}

/** Scheduled sessions whose reminder is due at `now`, and that haven't started. */
export async function dueReminders(now: number): Promise<Session[]> {
  const { results } = await database()
    .prepare(`
      SELECT * FROM sessions
      WHERE status = 'scheduled' AND reminder_minutes > 0 AND reminder_sent = 0
        AND start_at - reminder_minutes * 60 <= ? AND start_at > ?
      ORDER BY start_at
    `)
    .bind(now, now)
    .all<SessionRow>();
  return results.map(fromRow);
}

/** Scheduled sessions whose start time has come. */
export async function dueStarts(now: number): Promise<Session[]> {
  const { results } = await database()
    .prepare("SELECT * FROM sessions WHERE status = 'scheduled' AND start_at <= ? ORDER BY start_at")
    .bind(now)
    .all<SessionRow>();
  return results.map(fromRow);
}

/** Adds someone to a session. Returns false if they had already joined. */
export async function addParticipant(sessionId: string, userId: string): Promise<boolean> {
  return changed(
    database().prepare("INSERT OR IGNORE INTO session_participants (session_id, user_id) VALUES (?, ?)").bind(sessionId, userId),
  );
}

/** Returns false if they hadn't joined. */
export async function removeParticipant(sessionId: string, userId: string): Promise<boolean> {
  return changed(
    database().prepare("DELETE FROM session_participants WHERE session_id = ? AND user_id = ?").bind(sessionId, userId),
  );
}

/** User IDs of everyone who joined, in the order they joined. */
export async function participants(sessionId: string): Promise<string[]> {
  const { results } = await database()
    .prepare("SELECT user_id FROM session_participants WHERE session_id = ? ORDER BY joined_at, rowid")
    .bind(sessionId)
    .all<{ user_id: string }>();
  return results.map((row) => row.user_id);
}

/**
 * Runs a write and says whether it changed a row. D1 reports this as `meta.changes`; the test
 * database (Node's SQLite) as `changes`.
 */
async function changed(statement: { run(): Promise<unknown> }): Promise<boolean> {
  const result = (await statement.run()) as { changes?: number | bigint; meta?: { changes?: number } } | null;
  return Number(result?.meta?.changes ?? result?.changes ?? 0) > 0;
}
