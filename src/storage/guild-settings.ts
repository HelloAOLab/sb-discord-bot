import { database } from "./database.js";

// Per-server settings, changed by server admins with commands like /setseedbiblelinks.

const SEED_BIBLE_LINKS = "seed_bible_links";

function getSetting(guildId: string, name: string): string | undefined {
  const row = database()
    .prepare("SELECT value FROM guild_settings WHERE guild_id = ? AND name = ?")
    .get(guildId, name) as { value: string } | undefined;
  return row?.value;
}

function setSetting(guildId: string, name: string, value: string): void {
  database()
    .prepare(`
      INSERT INTO guild_settings (guild_id, name, value) VALUES (?, ?, ?)
      ON CONFLICT (guild_id, name) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `)
    .run(guildId, name, value);
}

/**
 * Whether replies in this server may include "Open in Seed Bible" links. On unless an admin
 * turned it off. Always on outside servers (DMs), where there's no one to turn it off.
 */
export function seedBibleLinksEnabled(guildId: string | undefined): boolean {
  if (guildId === undefined) return true;
  return getSetting(guildId, SEED_BIBLE_LINKS) !== "off";
}

export function setSeedBibleLinksEnabled(guildId: string, enabled: boolean): void {
  setSetting(guildId, SEED_BIBLE_LINKS, enabled ? "on" : "off");
}
