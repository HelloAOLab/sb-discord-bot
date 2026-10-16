import { database } from "./database.js";

// Per-user preferences, set with /preferences. They follow the user across servers.

export interface UserPreferences {
  /** Exact Bible API translation ID, e.g. "BSB". */
  translation?: string;
  /** Seed Bible interface language code, e.g. "es". */
  lang?: string;
  /** IANA time zone, e.g. "America/New_York". The session time picker remembers it too. */
  timeZone?: string;
}

const NAMES = { translation: "translation", lang: "lang", timeZone: "time_zone" } as const satisfies Record<keyof UserPreferences, string>;

export async function userPreferences(userId: string): Promise<UserPreferences> {
  const { results } = await database()
    .prepare("SELECT name, value FROM user_settings WHERE user_id = ?")
    .bind(userId)
    .all<{ name: string; value: string }>();
  const value = (name: string) => results.find((row) => row.name === name)?.value;
  const preferences: UserPreferences = {};
  for (const [key, name] of Object.entries(NAMES) as [keyof UserPreferences, string][]) {
    const found = value(name);
    if (found !== undefined) preferences[key] = found;
  }
  return preferences;
}

/** Saves the given preferences; `null` forgets one, so the default applies again. */
export async function setUserPreferences(
  userId: string,
  changes: { [K in keyof UserPreferences]?: string | null },
): Promise<void> {
  for (const [key, value] of Object.entries(changes) as [keyof UserPreferences, string | null | undefined][]) {
    if (value === undefined) continue;
    const name = NAMES[key];
    if (value === null) {
      await database().prepare("DELETE FROM user_settings WHERE user_id = ? AND name = ?").bind(userId, name).run();
    } else {
      await database()
        .prepare(`
          INSERT INTO user_settings (user_id, name, value) VALUES (?, ?, ?)
          ON CONFLICT (user_id, name) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
        `)
        .bind(userId, name, value)
        .run();
    }
  }
}
