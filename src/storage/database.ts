import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../utils/config.js";

// The app's only persistent storage: a SQLite file (config.DATABASE_PATH) opened with Node's
// built-in driver. Everything else the app knows comes from Discord or the Bible API per request.
// Calls are synchronous, which is fine for the handful of tiny reads and writes we do.

let db: DatabaseSync | undefined;

/** Opens the database on first use, creating its folder and tables if needed. */
export function database(): DatabaseSync {
  if (db) return db;

  const path = config.DATABASE_PATH;
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);

  // One row per server and setting, so new settings need no schema change.
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id   TEXT NOT NULL,
      name       TEXT NOT NULL,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (guild_id, name)
    )
  `);
  return db;
}

/** Closes the database (on shutdown). The next database() call reopens it. */
export function closeDatabase(): void {
  db?.close();
  db = undefined;
}
