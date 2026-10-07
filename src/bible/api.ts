import { FreeUseBibleApi } from "free-use-bible-api";

/** Shared Bible API client. It caches every response in memory for the life of the process. */
export const bibleApi = new FreeUseBibleApi();

/** The translation whose (English) book names are always accepted, whatever translation is chosen. */
export const ENGLISH_NAMES_TRANSLATION = "BSB";

/**
 * Fetches the data most requests need (the translation list and English book names) so the first
 * user doesn't wait for it. Autocomplete has the same 3-second limit as commands, and the
 * translation list is the largest download (~900 KB).
 */
export function warmBibleCache(api: FreeUseBibleApi = bibleApi): void {
  Promise.all([api.getAvailableTranslations(), api.getTranslationBooks(ENGLISH_NAMES_TRANSLATION)]).catch(
    (error) => console.warn("[bible] Couldn't preload Bible data:", error),
  );
}
