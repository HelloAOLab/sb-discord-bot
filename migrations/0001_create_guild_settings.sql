-- Per-server settings, one row per server and setting name (e.g. seed_bible_links = "off").
-- New settings need no schema change.
CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guild_id, name)
);
