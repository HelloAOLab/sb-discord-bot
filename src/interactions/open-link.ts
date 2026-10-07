import { ButtonStyle, ComponentType, type APIInteractionResponseCallbackData } from "discord-api-types/v10";
import type { FreeUseBibleApi } from "free-use-bible-api";
import { bibleApi } from "../bible/api.js";
import { findBook, loadBooks } from "../bible/books.js";
import { findTranslation } from "../bible/translations.js";
import { UserFacingError } from "../utils/errors.js";
import { seedBibleUrl, type SeedBibleTarget } from "../seedbible/links.js";

// Used by /open's book picker: checks a book/chapter/translation choice and builds the
// "Open John 3 (BSB) in Seed Bible: [Open →]" message.

/** What the link opens, plus a description for the message ("John 3 (BSB)"). */
export interface OpenLink {
  target: SeedBibleTarget;
  description?: string;
}

/**
 * Turns a book code, chapter and translation into a link target, using the Bible API to check them and
 * find their exact IDs. Without a chapter, the link opens the book's first chapter. Throws a
 * UserFacingError explaining any problem.
 */
export async function resolveOpenLink(
  input: { book: string; chapter?: number; translation?: string },
  api: FreeUseBibleApi = bibleApi,
): Promise<OpenLink> {
  const translation = input.translation === undefined ? undefined : await findTranslation(api, input.translation);
  const { books } = await loadBooks(api, translation?.id);
  const book = findBook(books, input.book);

  const { chapter } = input;
  if (
    chapter !== undefined &&
    (!Number.isInteger(chapter) || chapter < book.firstChapterNumber || chapter > book.lastChapterNumber)
  ) {
    throw new UserFacingError(
      book.numberOfChapters === 1
        ? `${book.commonName} has only one chapter.`
        : `${book.commonName} has chapters ${book.firstChapterNumber}–${book.lastChapterNumber}.`,
    );
  }

  let description = chapter === undefined ? book.commonName : `${book.commonName} ${chapter}`;
  if (translation) description += ` (${translation.shortName ?? translation.id})`;

  return {
    target: { book: book.id, chapter: chapter ?? book.firstChapterNumber, translation: translation?.id },
    description,
  };
}

/**
 * The reply: "Open John 3 (BSB) in Seed Bible:" with an "Open →" link button. Without a
 * description it just says "Open Seed Bible:". With `button: false` (the server turned Seed Bible
 * link buttons off), the address is written out in the text instead.
 */
export function openMessage(link: OpenLink, { button = true }: { button?: boolean } = {}): APIInteractionResponseCallbackData {
  const text = link.description === undefined ? "Open Seed Bible:" : `Open ${link.description} in Seed Bible:`;
  const url = seedBibleUrl(link.target);
  // The description includes names from the Bible API; never let it ping anyone.
  const allowed_mentions = { parse: [] };

  if (!button) return { content: `${text} ${plainLink(url)}`, allowed_mentions };
  return {
    content: text,
    components: [
      {
        type: ComponentType.ActionRow,
        components: [{ type: ComponentType.Button, style: ButtonStyle.Link, label: "Open →", url }],
      },
    ],
    allowed_mentions,
  };
}

/** A clickable address. The angle brackets stop Discord adding a large preview card under it. */
export const plainLink = (url: string) => `<${url}>`;
