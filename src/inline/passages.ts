import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type APIComponentInContainer,
  type APIContainerComponent,
} from "discord-api-types/v10";
import type {
  ApiSimpleTranslationBookChapter,
  ApiTranslation,
  ApiTranslationBook,
  FreeUseBibleApi,
} from "free-use-bible-api";
import { bibleApi } from "../bible/api.js";
import { describePassage, type BiblePassage, type PassageSegment } from "../bible/references.js";
import { plainLink } from "../interactions/open-link.js";
import { seedBibleChapterUrl } from "../seedbible/links.js";

// Builds the replies to the Bible passages found in a message (see inline/messages.ts): one reply
// per passage, each a message made of components ("Components V2"), not plain text. It's a box
// with the passage's title, its text (cut short to fit Discord's limit) and an "Open in Seed
// Bible" button. Where /setseedbiblelinks turned link buttons off, the link is written out instead.
//
//   "genesis"        → Genesis 1          → https://seedbible.org/genesis/1?source=discord_bot
//   "genesis 2"      → Genesis 2          → https://seedbible.org/genesis/2?source=discord_bot
//   "genesis 2 3-4"  → Genesis 2:3-4      → https://seedbible.org/genesis/2?verse=3-4&source=discord_bot

/**
 * Inline replies use this translation's text (the Accessible Ancients Bible, also Seed Bible's
 * default) until users and servers can choose their own.
 */
export const INLINE_TRANSLATION = "AAB";

/** Discord's limit on all the text in a components message. */
const TEXT_LIMIT = 4000;
/** A passage over several chapters ("Genesis 1-50") loads at most this many; more never fit. */
const MAX_CHAPTERS = 3;

/** A reply, ready to post to a channel. */
export interface PassageReply {
  flags: MessageFlags.IsComponentsV2;
  components: [APIContainerComponent];
  /** Bible text and names must never ping anyone. */
  allowed_mentions: { parse: [] };
}

/** A passage's title, text and link, before it's fitted into a message. */
interface LoadedPassage {
  title: string;
  body: string;
  url: string;
}

/**
 * One reply per passage, in the order written. Passages that don't exist (John 22, John 3:99) are
 * skipped without a reply, since the user didn't ask the bot anything.
 */
export async function passageReplies(
  passages: BiblePassage[],
  { buttons }: { buttons: boolean },
  api: FreeUseBibleApi = bibleApi,
): Promise<PassageReply[]> {
  const { books } = await api.getTranslationBooks(INLINE_TRANSLATION);
  // The passages don't depend on each other, so their chapters load at the same time.
  const loaded = await Promise.all(
    passages.map((passage) => {
      const book = books.find((b) => b.id === passage.book);
      return book ? loadPassage(passage, book, api) : null;
    }),
  );
  return loaded.filter((passage) => passage !== null).map((passage) => reply(passage, buttons));
}

/** The message for one passage: a box with its title, text and Seed Bible link. */
function reply({ title, body, url }: LoadedPassage, buttons: boolean): PassageReply {
  const heading = `### ${title}\n`;
  const link = buttons ? "" : `\n\nOpen in Seed Bible: ${plainLink(url)}`;
  const content = heading + cutToFit(body, TEXT_LIMIT - heading.length - link.length) + link;

  const parts: APIComponentInContainer[] = [{ type: ComponentType.TextDisplay, content }];
  if (buttons) {
    parts.push({
      type: ComponentType.ActionRow,
      components: [{ type: ComponentType.Button, style: ButtonStyle.Link, label: "Open in Seed Bible →", url }],
    });
  }
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [{ type: ComponentType.Container, components: parts }],
    allowed_mentions: { parse: [] },
  };
}

/**
 * Loads a passage's verses and builds its title, text and Seed Bible link. Returns null if none
 * of its verses exist or its chapters can't be loaded.
 */
async function loadPassage(passage: BiblePassage, book: ApiTranslationBook, api: FreeUseBibleApi): Promise<LoadedPassage | null> {
  // Each segment within the book's chapters, and at most MAX_CHAPTERS long.
  const segments = passage.segments
    .filter((s) => s.startChapter >= book.firstChapterNumber && s.startChapter <= book.lastChapterNumber)
    .map((s) => ({ segment: s, lastChapter: Math.min(s.endChapter, book.lastChapterNumber, s.startChapter + MAX_CHAPTERS - 1) }));

  // Load every chapter needed at once rather than one after another.
  const numbers = [...new Set(segments.flatMap(({ segment, lastChapter }) => range(segment.startChapter, lastChapter)))];
  const chapters = new Map(
    await Promise.all(
      numbers.map(async (number) => {
        try {
          return [number, await api.getSimpleTranslationBookChapter(INLINE_TRANSLATION, book.id, number)] as const;
        } catch (error) {
          console.warn(`[inline] Couldn't load ${book.id} ${number}:`, error);
          return [number, null] as const;
        }
      }),
    ),
  );

  const lines: { chapter: number; verse?: number; text: string }[] = [];
  const shown: PassageSegment[] = [];
  let translation: ApiTranslation | undefined;

  for (const { segment, lastChapter } of segments) {
    let shownTo: { chapter: number; verse: number } | undefined;
    for (const number of range(segment.startChapter, lastChapter)) {
      const chapter: ApiSimpleTranslationBookChapter | null | undefined = chapters.get(number);
      if (!chapter) break;
      translation = chapter.translation;
      const from = number === segment.startChapter ? (segment.startVerse ?? 1) : 1;
      const to = number === segment.endChapter ? (segment.endVerse ?? Infinity) : Infinity;
      for (const item of chapter.chapter.content) {
        // A psalm's title ("A Psalm of David.") opens it when the whole psalm is shown.
        if (item.type === "hebrew_subtitle" && (segment.startVerse === undefined || number !== segment.startChapter)) {
          lines.push({ chapter: number, text: `*${escapeMarkdown(item.text)}*` });
        }
        if (item.type === "verse" && item.number >= from && item.number <= to) {
          lines.push({ chapter: number, verse: item.number, text: escapeMarkdown(item.text) });
          shownTo = { chapter: number, verse: item.number };
        }
      }
    }
    if (!shownTo) continue;

    // Name only what's shown. "John 3:35-40" in a 36-verse chapter is "John 3:35-36". A range
    // cut short at MAX_CHAPTERS ("Gen 1:5-10:3") shows whole chapters up to where it stopped:
    // "Genesis 1:5-3".
    const reachedEnd = shownTo.chapter === segment.endChapter;
    shown.push({
      ...segment,
      endChapter: shownTo.chapter,
      endVerse: reachedEnd && segment.endVerse !== undefined ? shownTo.verse : undefined,
    });
  }
  if (shown.length === 0 || !translation) return null;

  const firstChapter = shown[0]!.startChapter;
  const oneChapter = shown.every((s) => s.startChapter === firstChapter && s.endChapter === firstChapter);

  let body: string;
  if (lines.length === 1) {
    body = lines[0]!.text;
  } else {
    // Over several chapters, each chapter's first verse says which chapter it is ("4:1").
    let labelledChapter: number | undefined;
    body = lines
      .map((line) => {
        if (line.verse === undefined) return line.text;
        const newChapter = !oneChapter && line.chapter !== labelledChapter;
        labelledChapter = line.chapter;
        return `**${newChapter ? `${line.chapter}:` : ""}${line.verse}** ${line.text}`;
      })
      .join("\n");
  }

  // One psalm is "Psalm 23"; several are "Psalms 1-3".
  const bookName = book.id === "PSA" && oneChapter ? "Psalm" : book.commonName;
  const title = `${describePassage({ book: book.id, segments: shown }, bookName)} (${translation.shortName ?? translation.id})`;

  // Link to the passage's first chapter, with its verses when they're all in that chapter.
  const verse = oneChapter && shown.every((s) => s.startVerse !== undefined)
    ? shown.map((s) => (s.endVerse === undefined || s.endVerse === s.startVerse ? `${s.startVerse}` : `${s.startVerse}-${s.endVerse}`)).join(",")
    : undefined;
  const url = seedBibleChapterUrl({ book: book.commonName, chapter: firstChapter, verse });

  return { title, body, url };
}

/**
 * Shortens `text` to at most `max` characters, ending with "…". It cuts between lines (or, inside
 * one long verse, between words), so the cut never splits a "**12**" verse number or a "\*" escape
 * and leaves stray formatting.
 */
function cutToFit(text: string, max: number): string {
  if (text.length <= max) return text;
  const room = text.slice(0, max - 1);
  const lineBreak = room.lastIndexOf("\n");
  const space = room.search(/\s\S*$/);
  // Prefer a whole line, unless that would throw away more than half the room.
  const cut = lineBreak >= max / 2 ? lineBreak : space > 0 ? space : room.length;
  return `${text.slice(0, cut).trimEnd()}…`;
}

/** The whole numbers from `first` to `last`. */
const range = (first: number, last: number) => Array.from({ length: Math.max(last - first + 1, 0) }, (_, i) => first + i);

/**
 * Stops Bible text from being read as Discord formatting: "*" or "_" turning text italic, or a
 * line of poetry that starts with "#" or ">" becoming a heading or a quote.
 */
function escapeMarkdown(text: string): string {
  return text.replace(/[\\*_~`|]/g, "\\$&").replace(/^([#>-])/gm, "\\$1");
}
