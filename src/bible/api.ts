import { FreeUseBibleApi } from "free-use-bible-api";

/**
 * Shared Bible API client. It caches responses in memory for as long as the Worker instance lives
 * (Cloudflare reuses an instance for many requests, but starts fresh ones at any time).
 */
export const bibleApi = new FreeUseBibleApi();

/** The translation whose (English) book names are shown alongside other languages' names. */
export const ENGLISH_NAMES_TRANSLATION = "BSB";
