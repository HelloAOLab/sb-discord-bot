import { database } from "./database.js";

// Per-server settings, changed by server admins with commands like /setseedbiblelinks.

const SEED_BIBLE_LINKS = "seed_bible_links";
const INLINE_VERSES = "inline_verses";

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

/**
 * Whether the bot replies to Bible references in this server's messages (/setinlineverses).
 * Off unless an admin turned it on: not every server wants the bot answering their chat.
 */
export async function inlineVersesEnabled(guildId: string): Promise<boolean> {
  return (await getSetting(guildId, INLINE_VERSES)) === "on";
}

export async function setInlineVersesEnabled(guildId: string, enabled: boolean): Promise<void> {
  await setSetting(guildId, INLINE_VERSES, enabled ? "on" : "off");
}

/**
 * Both settings an inline-verses reply needs, in one query: it runs for every message in any server
 * that looks like it has a reference, so it's worth a single round trip.
 */
export async function inlineReplySettings(guildId: string): Promise<{ inlineVerses: boolean; seedBibleLinks: boolean }> {
  const { results } = await database()
    .prepare("SELECT name, value FROM guild_settings WHERE guild_id = ? AND name IN (?, ?)")
    .bind(guildId, INLINE_VERSES, SEED_BIBLE_LINKS)
    .all<{ name: string; value: string }>();
  const value = (name: string) => results.find((row) => row.name === name)?.value;
  return { inlineVerses: value(INLINE_VERSES) === "on", seedBibleLinks: value(SEED_BIBLE_LINKS) !== "off" };
}

/** Whether any server has inline verses on. The Gateway connection only runs while one does. */
export async function anyInlineVersesEnabled(): Promise<boolean> {
  const row = await database()
    .prepare("SELECT 1 AS found FROM guild_settings WHERE name = ? AND value = 'on' LIMIT 1")
    .bind(INLINE_VERSES)
    .first();
  return row !== null;
}
