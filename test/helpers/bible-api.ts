import { vi } from "vitest";
import type { ApiTranslation, ApiTranslationBook, BookId } from "free-use-bible-api";

// A tiny stand-in for the Free Use Bible API (https://bible.helloao.org), shaped like the real
// responses but with only the translations and books the tests need.

function translation(id: string, shortName: string, englishName: string, language: string, languageEnglishName: string): ApiTranslation {
  return {
    id,
    name: englishName,
    englishName,
    shortName,
    language,
    languageEnglishName,
    textDirection: "ltr",
    website: "https://example.org",
    licenseUrl: "https://example.org/license",
    listOfBooksApiLink: `/api/${id}/books.json`,
    availableFormats: ["json"],
    numberOfBooks: 66,
    totalNumberOfChapters: 1189,
    totalNumberOfVerses: 31102,
  };
}

export const translations: ApiTranslation[] = [
  translation("BSB", "BSB", "Berean Standard Bible", "eng", "English"),
  translation("ENGWEBP", "WEB", "World English Bible", "eng", "English"),
  translation("eng_kjv", "KJAV", "King James Version", "eng", "English"),
  translation("eng_kja", "KJVA", "King James Version + Apocrypha", "eng", "English"),
  translation("tha_kjv", "KJV", "Thai KJV Bible", "tha", "Thai"),
  translation("eng_web", "WEBC", "World English Bible Classic", "eng", "English"),
  translation("eng_webc", "WEBC", "World English Bible (Catholic)", "eng", "English"),
  translation("eng_webpb", "WEBBE", "World English Bible British Edition", "eng", "English"),
  translation("eng_weu", "WEBBE", "World English Bible British Edition with Deuterocanon", "eng", "English"),
  translation("spa_r09", "R09", "Reina Valera 1909", "spa", "Spanish"),
  translation("spa_rvg", "RVG", "RVG Spanish Bible", "spa", "Spanish"),
];

function book(id: BookId, order: number, name: string, chapters: number, commonName = name): ApiTranslationBook {
  const reference = { translationId: "BSB", book: id, chapter: 1 };
  return {
    id,
    name,
    commonName,
    title: name,
    order,
    firstChapterNumber: 1,
    firstChapterApiLink: "",
    firstChapterReference: reference,
    lastChapterNumber: chapters,
    lastChapterApiLink: "",
    lastChapterReference: reference,
    numberOfChapters: chapters,
    totalNumberOfVerses: 100,
  };
}

// All 66 books, with their real chapter counts, so menus need several pages as they do live.
const ENGLISH: [BookId, string, number][] = [
  ["GEN", "Genesis", 50], ["EXO", "Exodus", 40], ["LEV", "Leviticus", 27], ["NUM", "Numbers", 36],
  ["DEU", "Deuteronomy", 34], ["JOS", "Joshua", 24], ["JDG", "Judges", 21], ["RUT", "Ruth", 4],
  ["1SA", "1 Samuel", 31], ["2SA", "2 Samuel", 24], ["1KI", "1 Kings", 22], ["2KI", "2 Kings", 25],
  ["1CH", "1 Chronicles", 29], ["2CH", "2 Chronicles", 36], ["EZR", "Ezra", 10], ["NEH", "Nehemiah", 13],
  ["EST", "Esther", 10], ["JOB", "Job", 42], ["PSA", "Psalms", 150], ["PRO", "Proverbs", 31],
  ["ECC", "Ecclesiastes", 12], ["SNG", "Song", 8], ["ISA", "Isaiah", 66], ["JER", "Jeremiah", 52],
  ["LAM", "Lamentations", 5], ["EZK", "Ezekiel", 48], ["DAN", "Daniel", 12], ["HOS", "Hosea", 14],
  ["JOL", "Joel", 3], ["AMO", "Amos", 9], ["OBA", "Obadiah", 1], ["JON", "Jonah", 4],
  ["MIC", "Micah", 7], ["NAM", "Nahum", 3], ["HAB", "Habakkuk", 3], ["ZEP", "Zephaniah", 3],
  ["HAG", "Haggai", 2], ["ZEC", "Zechariah", 14], ["MAL", "Malachi", 4], ["MAT", "Matthew", 28],
  ["MRK", "Mark", 16], ["LUK", "Luke", 24], ["JHN", "John", 21], ["ACT", "Acts", 28],
  ["ROM", "Romans", 16], ["1CO", "1 Corinthians", 16], ["2CO", "2 Corinthians", 13], ["GAL", "Galatians", 6],
  ["EPH", "Ephesians", 6], ["PHP", "Philippians", 4], ["COL", "Colossians", 4], ["1TH", "1 Thessalonians", 5],
  ["2TH", "2 Thessalonians", 3], ["1TI", "1 Timothy", 6], ["2TI", "2 Timothy", 4], ["TIT", "Titus", 3],
  ["PHM", "Philemon", 1], ["HEB", "Hebrews", 13], ["JAS", "James", 5], ["1PE", "1 Peter", 5],
  ["2PE", "2 Peter", 3], ["1JN", "1 John", 5], ["2JN", "2 John", 1], ["3JN", "3 John", 1],
  ["JUD", "Jude", 1], ["REV", "Revelation", 22],
];

// Like the real BSB, the Song of Songs is named "Song" with the common name "Song of Solomon".
const englishBooks: ApiTranslationBook[] = ENGLISH.map(([id, name, chapters], index) =>
  book(id, index + 1, name, chapters, id === "SNG" ? "Song of Solomon" : name),
);

const spanishBooks: ApiTranslationBook[] = [
  book("GEN", 1, "Génesis", 50),
  book("PSA", 19, "Salmos", 150),
  book("JHN", 43, "Juan", 21),
  book("1CO", 46, "1 Corintios", 16),
  // Leaves out Jude, to test a book missing from the chosen translation.
];

/** Books per translation ID. Any other listed translation gets the English books. */
const booksByTranslation: Record<string, ApiTranslationBook[]> = {
  eng_kja: [...englishBooks, { ...book("TOB", 67, "Tobit", 14), isApocryphal: true }],
  spa_r09: spanishBooks,
  spa_rvg: spanishBooks,
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

/** Answers a Bible API URL from the fixtures above, or 404 like the real API does for a wrong ID. */
export function bibleApiResponse(url: string): Response {
  const path = new URL(url).pathname;
  if (path === "/api/available_translations.json") return json({ translations });

  const books = /^\/api\/([^/]+)\/books\.json$/.exec(path);
  const id = books ? decodeURIComponent(books[1]!) : undefined;
  const found = translations.find((t) => t.id === id);
  if (found) return json({ translation: found, books: booksByTranslation[found.id] ?? englishBooks });

  return new Response("Not found", { status: 404 });
}

export interface FetchCall {
  url: string;
  method: string;
  body: any;
}

/**
 * Replaces global fetch: Bible API requests get fixture data, and Discord API requests succeed
 * with 204 (or `discordStatus`) and are recorded in `discordCalls`. Undone after each test by
 * `restoreMocks`.
 */
export function mockFetch(options: { discordStatus?: number } = {}) {
  const discordCalls: FetchCall[] = [];

  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://bible.helloao.org/")) return bibleApiResponse(url);
    if (url.startsWith("https://discord.com/api/")) {
      discordCalls.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      const status = options.discordStatus ?? 204;
      return new Response(status === 204 ? null : "error", { status });
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  });

  return { spy, discordCalls };
}
