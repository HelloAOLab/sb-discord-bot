import { bcv_parser } from "bible-passage-reference-parser";
import * as english from "bible-passage-reference-parser/esm/lang/en.js";

// Finds Bible references written in ordinary chat messages, using the openbibleinfo Bible Passage
// Reference Parser (https://github.com/openbibleinfo/Bible-Passage-Reference-Parser), which
// understands nearly any way of writing one: "John 3:16", "Romans 8:28-30", "Ps 23",
// "genesis 2 3-4", "John 1:1-3, 5", "Jn 3:16; 4:2", "1 Cor 13", or a book on its own ("Genesis",
// meaning its first chapter). It only reads the text; the caller checks the passages exist.

/** A run of the Bible within one book. Without verses, it covers whole chapters. */
export interface PassageSegment {
  startChapter: number;
  /** Unset: from the start of the chapter. */
  startVerse?: number;
  /** Infinity for a range that ran into the next book ("Gen 50-Exod 2"); cut at the book's end. */
  endChapter: number;
  /** Unset: to the end of the chapter. */
  endVerse?: number;
}

export interface BiblePassage {
  /** USFM book code, e.g. "JHN". */
  book: string;
  /** In the order written: "John 1:1-3, 5" is two segments. */
  segments: PassageSegment[];
}

/** At most this many passages (each its own reply) are taken from one message, so a list can't flood the channel. */
export const MAX_PASSAGES = 3;

// The parser names books by OSIS code; the Bible API by USFM code. Each entry also lists the
// book's full English names: a book written on its own only counts when written in full (below).
const BOOKS: [osis: string, usfm: string, ...names: string[]][] = [
  ["Gen", "GEN", "Genesis"], ["Exod", "EXO", "Exodus"], ["Lev", "LEV", "Leviticus"], ["Num", "NUM", "Numbers"],
  ["Deut", "DEU", "Deuteronomy"], ["Josh", "JOS", "Joshua"], ["Judg", "JDG", "Judges"], ["Ruth", "RUT", "Ruth"],
  ["1Sam", "1SA", "1 Samuel"], ["2Sam", "2SA", "2 Samuel"], ["1Kgs", "1KI", "1 Kings"], ["2Kgs", "2KI", "2 Kings"],
  ["1Chr", "1CH", "1 Chronicles"], ["2Chr", "2CH", "2 Chronicles"], ["Ezra", "EZR", "Ezra"], ["Neh", "NEH", "Nehemiah"],
  ["Esth", "EST", "Esther"], ["Job", "JOB", "Job"], ["Ps", "PSA", "Psalms", "Psalm"], ["Prov", "PRO", "Proverbs"],
  ["Eccl", "ECC", "Ecclesiastes"], ["Song", "SNG", "Song of Songs", "Song of Solomon"], ["Isa", "ISA", "Isaiah"],
  ["Jer", "JER", "Jeremiah"], ["Lam", "LAM", "Lamentations"], ["Ezek", "EZK", "Ezekiel"], ["Dan", "DAN", "Daniel"],
  ["Hos", "HOS", "Hosea"], ["Joel", "JOL", "Joel"], ["Amos", "AMO", "Amos"], ["Obad", "OBA", "Obadiah"],
  ["Jonah", "JON", "Jonah"], ["Mic", "MIC", "Micah"], ["Nah", "NAM", "Nahum"], ["Hab", "HAB", "Habakkuk"],
  ["Zeph", "ZEP", "Zephaniah"], ["Hag", "HAG", "Haggai"], ["Zech", "ZEC", "Zechariah"], ["Mal", "MAL", "Malachi"],
  ["Matt", "MAT", "Matthew"], ["Mark", "MRK", "Mark"], ["Luke", "LUK", "Luke"], ["John", "JHN", "John"],
  ["Acts", "ACT", "Acts"], ["Rom", "ROM", "Romans"], ["1Cor", "1CO", "1 Corinthians"], ["2Cor", "2CO", "2 Corinthians"],
  ["Gal", "GAL", "Galatians"], ["Eph", "EPH", "Ephesians"], ["Phil", "PHP", "Philippians"], ["Col", "COL", "Colossians"],
  ["1Thess", "1TH", "1 Thessalonians"], ["2Thess", "2TH", "2 Thessalonians"], ["1Tim", "1TI", "1 Timothy"],
  ["2Tim", "2TI", "2 Timothy"], ["Titus", "TIT", "Titus"], ["Phlm", "PHM", "Philemon"], ["Heb", "HEB", "Hebrews"],
  ["Jas", "JAS", "James"], ["1Pet", "1PE", "1 Peter"], ["2Pet", "2PE", "2 Peter"], ["1John", "1JN", "1 John"],
  ["2John", "2JN", "2 John"], ["3John", "3JN", "3 John"], ["Jude", "JUD", "Jude"], ["Rev", "REV", "Revelation", "Revelations"],
];

const USFM_BY_OSIS = new Map(BOOKS.map(([osis, usfm]) => [osis, usfm]));
const FULL_NAMES = new Set(BOOKS.flatMap(([, , ...names]) => names.map((name) => name.toLowerCase())));

/**
 * Abbreviations the parser accepts that are also everyday words, so they never count, even before
 * a number: "it is 5 pm" isn't Isaiah 5 and "I am 2 hours late" isn't Amos 2. The usual
 * abbreviations ("Isa 5", "Gen", "Ps", "Jn", "Col") still work.
 */
const COMMON_WORDS = new Set([
  "is", "so", "am", "ex", "la", "le", "ne", "da", "es", "ge", "ha", "jo", "ju", "lu", "ma", "mi", "na", "nu", "ro", "ti",
  "ob", "ec", "pr", "act", "mar", "mat", "pro", "jam", "joe", "number", "kings",
]);

/**
 * Full book names that are also common words or first names. Written alone they don't count
 * ("I got a job", "Mark is coming", "those numbers"); with a chapter they do ("Job 3", "Mark 2:17").
 */
const AMBIGUOUS_ALONE = new Set([
  "job", "mark", "john", "luke", "acts", "numbers", "judges", "ruth", "esther", "ezra", "daniel", "joel", "amos",
  "jonah", "micah", "james", "jude", "titus", "joshua", "proverbs", "revelation", "revelations", "romans", "hebrews",
  "exodus", "lamentations",
]);

/** Code, links and Discord markup (mentions, emoji, timestamps) never contain references. */
const IGNORED_TEXT = /```[\s\S]*?```|`[^`\n]*`|https?:\/\/\S+|<[^>\s]+>/g;

let parser: bcv_parser | undefined;

/** The parser, set up on first use (building its patterns takes a few milliseconds). */
function getParser(): bcv_parser {
  parser ??= new bcv_parser(english).set_options({
    // "Genesis" on its own means Genesis 1.
    book_alone_strategy: "first_chapter",
    book_sequence_strategy: "include",
    // Each part of "John 1:1-3, 5" separately, with where it was written (joined again below).
    sequence_combination_strategy: "separate",
    // Whole chapters stay chapters: "Gen.1", not "Gen.1.1-Gen.1.31".
    osis_compaction_strategy: "bc",
    // "Matt 5 1Hi" is Matthew 5, not 5:1: better for chat than for search boxes.
    captive_end_digits_strategy: "delete",
    testaments: "on",
  });
  return parser;
}

/**
 * The Bible passages in a message, in the order written, at most MAX_PASSAGES of them. Parts that
 * continue the previous reference ("5" in "John 1:1-3, 5", "4:2" in "Jn 3:16; 4:2") join its
 * passage; a newly named book starts a new one.
 */
export function findPassages(text: string): BiblePassage[] {
  // Blank out ignored text rather than removing it, so positions still match the message.
  const cleaned = text.replace(IGNORED_TEXT, (match) => " ".repeat(match.length));
  const passages: BiblePassage[] = [];
  let previous: BiblePassage | undefined;

  const parser = getParser();
  parser.parse(cleaned);
  // Typed here: the package's own types don't resolve under NodeNext.
  const results: { osis: string; indices: [number, number] }[] = parser.osis_and_indices();
  for (const { osis, indices } of results) {
    const written = cleaned.slice(indices[0], indices[1]).trim();
    // The book as written, without its chapter and verses: "gen 1 1" → "gen". Empty for a part
    // that continues the previous reference ("5" in "John 1:1-3, 5").
    const writtenBook = written.replace(/[\s:,;\-–—\d]+$/, "");
    const bookText = normalizeBookName(writtenBook);
    const counts = /\d/.test(written)
      ? // An everyday word written as an abbreviation, with a dot ("Ex. 3:14"), still counts.
        !COMMON_WORDS.has(bookText) || writtenBook.endsWith(".")
      : // A book on its own means its first chapter, but only when written in full ("genesis"),
        // since the parser also reads "is", "so" and "Ex" alone as books, and only when the name
        // isn't also an everyday word or first name.
        FULL_NAMES.has(bookText) && !AMBIGUOUS_ALONE.has(bookText);
    if (!counts) {
      previous = undefined;
      continue;
    }

    const parts = osis.split(",").map(parseOsisRange);
    if (parts.some((part) => part === null) || parts.length === 0) continue;
    const book = parts[0]!.book;
    const segments = parts.map((part) => part!.segment);

    if (bookText === "") {
      // Continues the previous reference. With none ("it is 5, 6": "is 5" was skipped), the
      // numbers alone mean nothing.
      if (previous && parts.every((part) => part!.book === previous!.book)) previous.segments.push(...segments);
      continue;
    }
    if (passages.length === MAX_PASSAGES) break;
    previous = { book, segments };
    passages.push(previous);
  }
  return passages;
}

/** "First  John" → "1 john", "1john" → "1 john", "Ex." → "ex": the forms in the sets above. */
function normalizeBookName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\.$/, "")
    .replace(/\s+/g, " ")
    .replace(/^(?:first|1st|i)\s+/, "1 ")
    .replace(/^(?:second|2nd|ii)\s+/, "2 ")
    .replace(/^(?:third|3rd|iii)\s+/, "3 ")
    .replace(/^([123])\s*/, "$1 ");
}

/** "Gen.2.3-Gen.2.4" → GEN, chapter 2, verses 3-4. Null for a book this app doesn't know. */
function parseOsisRange(osis: string): { book: string; segment: PassageSegment } | null {
  const [startText = "", endText = startText] = osis.split("-");
  const start = parseOsisPoint(startText);
  const end = parseOsisPoint(endText);
  const book = start && USFM_BY_OSIS.get(start.book);
  if (!start || !end || !book) return null;

  const sameBook = end.book === start.book;
  return {
    book,
    segment: {
      startChapter: start.chapter,
      startVerse: start.verse,
      endChapter: sameBook ? end.chapter : Infinity,
      endVerse: sameBook ? end.verse : undefined,
    },
  };
}

/** "Gen.2.3" → { Gen, 2, 3 }; "Gen.2" → { Gen, 2 }. */
function parseOsisPoint(osis: string): { book: string; chapter: number; verse?: number } | null {
  const [book = "", chapter, verse] = osis.split(".");
  if (chapter === undefined || !/^\d+$/.test(chapter) || (verse !== undefined && !/^\d+$/.test(verse))) return null;
  return { book, chapter: Number(chapter), verse: verse === undefined ? undefined : Number(verse) };
}

/**
 * "John 3:16", "John 1:1-3, 5", "Genesis 1-3", "John 3:16-4:2" or "Jn 3:16; 4:2", using
 * `bookName` for the book. Expects segments already cut to chapters that exist (no Infinity).
 */
export function describePassage({ segments }: BiblePassage, bookName: string): string {
  let text = `${bookName} `;
  segments.forEach((segment, index) => {
    const before = segments[index - 1];
    // A further verse range in the chapter the last one ended in: "1:1-3, 5".
    const sameChapter =
      before?.endVerse !== undefined &&
      segment.startVerse !== undefined &&
      segment.startChapter === before.endChapter &&
      segment.endChapter === segment.startChapter;
    if (before) text += sameChapter ? ", " : "; ";
    text += sameChapter ? verseRange(segment) : describeSegment(segment);
  });
  return text;
}

function describeSegment(segment: PassageSegment): string {
  const { startChapter, startVerse, endChapter, endVerse } = segment;
  if (startVerse === undefined) return startChapter === endChapter ? `${startChapter}` : `${startChapter}-${endChapter}`;
  if (startChapter === endChapter) return `${startChapter}:${verseRange(segment)}`;
  return `${startChapter}:${startVerse}-${endChapter}${endVerse === undefined ? "" : `:${endVerse}`}`;
}

/** "16" or "28-30", for a segment within one chapter. */
function verseRange({ startVerse, endVerse }: PassageSegment): string {
  return endVerse === undefined || endVerse === startVerse ? `${startVerse}` : `${startVerse}-${endVerse}`;
}
