-- Reading sessions planned with /launchsession (src/sessions/). A session is one chapter read
-- together in Seed Bible; its Seed Bible link carries sessionId=session-<id>.
--   status: draft (its time is still being picked), scheduled, started, or cancelled
--   local_time / time_zone: the day and time picked ("2026-10-14T19:00", "America/New_York")
--   start_at / reminder_minutes: Unix seconds; the reminder goes out that many minutes before
CREATE TABLE IF NOT EXISTS sessions (
  id               TEXT    NOT NULL PRIMARY KEY,
  guild_id         TEXT    NOT NULL,
  channel_id       TEXT    NOT NULL,
  creator_id       TEXT    NOT NULL,
  title            TEXT,
  book             TEXT    NOT NULL,
  book_name        TEXT    NOT NULL,
  chapter          INTEGER NOT NULL,
  status           TEXT    NOT NULL,
  local_time       TEXT,
  time_zone        TEXT,
  start_at         INTEGER,
  reminder_minutes INTEGER NOT NULL DEFAULT 0,
  reminder_sent    INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- The cron looks for scheduled sessions that are due every minute.
CREATE INDEX IF NOT EXISTS sessions_by_status_and_start ON sessions (status, start_at);

-- Who joined each session: they're pinged by its reminder and when it starts.
CREATE TABLE IF NOT EXISTS session_participants (
  session_id TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  joined_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, user_id)
);

-- Per-user preferences (/preferences), one row per user and name, like guild_settings:
-- translation, lang (Seed Bible's interface language) and time_zone.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, name)
);
