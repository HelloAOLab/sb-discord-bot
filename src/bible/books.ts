import type { ApiTranslation, ApiTranslationBook, FreeUseBibleApi } from "free-use-bible-api";
import { UserFacingError } from "../utils/errors.js";
import { ENGLISH_NAMES_TRANSLATION } from "./api.js";

export interface TranslationBooks {
  /** The translation the books are from. */
  translation: ApiTranslation;
  /** The books in the chosen translation, named in its language ("Juan"). */
  books: ApiTranslationBook[];
  /** English names (from BSB), shown alongside other languages' names. Empty when the translation is BSB. */
  englishBooks: ApiTranslationBook[];
}

/** Loads a translation's books, plus their English names. */
export async function loadBooks(
  api: FreeUseBibleApi,
  translationId: string = ENGLISH_NAMES_TRANSLATION,
): Promise<TranslationBooks> {
  const { translation, books } = await api.getTranslationBooks(translationId);
  const englishBooks =
    translationId === ENGLISH_NAMES_TRANSLATION ? [] : (await api.getTranslationBooks(ENGLISH_NAMES_TRANSLATION)).books;
  return { translation, books, englishBooks };
}

/**
 * Finds a book by its USFM code ("JHN"), as sent by the book picker. Throws a UserFacingError if
 * the translation doesn't have it (only possible with a tampered or outdated menu).
 */
export function findBook(books: ApiTranslationBook[], id: string): ApiTranslationBook {
  const book = books.find((b) => b.id === id);
  if (!book) throw new UserFacingError(`That translation doesn't include the book "${id}".`);
  return book;
}
