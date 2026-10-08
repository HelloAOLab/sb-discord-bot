import { database } from "./database.js";

// Per-server settings, changed by server admins with commands like /setseedbiblelinks.

const SEED_BIBLE_LINKS = "seed_bible_links";

async function getSetting(guildId: string, name: string): Promise<string | undefined> {
  const row = await database()
    .prepare("SELECT value FROM guild_settings WHERE guild_id = ? AND name = ?")
    .bind(guildId, name)
    .first<{ value: string }>();
  return row?.value;
}

async function setSetting(guildId: string, name: string, value: string): Promise<void> {
  await database()
    .prepare(`
      INSERT INTO guild_settings (guild_id, name, value) VALUES (?, ?, ?)
      ON CONFLICT (guild_id, name) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `)
    .bind(guildId, name, value)
    .run();
}

/**
 * Whether Seed Bible links in this server are shown as buttons (true) or written out as text
 * (false). On unless an admin turned it off. Always on outside servers (DMs).
 */
export async function seedBibleLinksEnabled(guildId: string | undefined): Promise<boolean> {
  if (guildId === undefined) return true;
  return (await getSetting(guildId, SEED_BIBLE_LINKS)) !== "off";
}

export async function setSeedBibleLinksEnabled(guildId: string, enabled: boolean): Promise<void> {
  await setSetting(guildId, SEED_BIBLE_LINKS, enabled ? "on" : "off");
}
