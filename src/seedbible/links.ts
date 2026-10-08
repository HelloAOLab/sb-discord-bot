const SEED_BIBLE_URL = "https://seedbible.org/";

/** What a seedbible.org link opens. Every field is optional; the site fills in its own defaults. */
export interface SeedBibleTarget {
  /** USFM book code, e.g. "JHN". */
  book?: string;
  chapter?: number;
  /** Bible API translation ID, exactly as the API spells it, e.g. "BSB" or "spa_r09". */
  translation?: string;
  /** Interface language code from UI_LANGUAGES, e.g. "es". Separate from the translation. */
  lang?: string;
}

/**
 * Builds a seedbible.org link, e.g.
 * https://seedbible.org/?book=JHN&chapter=3&translation=BSB&source=discord_bot
 * `source=discord_bot` is always added so the site can tell where visits come from.
 */
export function seedBibleUrl(target: SeedBibleTarget = {}): string {
  const url = new URL(SEED_BIBLE_URL);
  const params: [string, string | number | undefined][] = [
    ["book", target.book],
    ["chapter", target.chapter],
    ["translation", target.translation],
    ["lang", target.lang],
    ["source", "discord_bot"],
  ];
  for (const [name, value] of params) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }
  return url.toString();
}
