import { describe, expect, it } from "vitest";
import { FreeUseBibleApi, type ApiTranslationBook } from "free-use-bible-api";
import { findBook, loadBooks } from "../../src/bible/books.js";
import { UserFacingError } from "../../src/utils/errors.js";
import { bibleApiResponse, mockFetch } from "../helpers/bible-api.js";

const booksOf = async (translation: string): Promise<ApiTranslationBook[]> =>
  (await bibleApiResponse(`https://bible.helloao.org/api/${translation}/books.json`).json()).books;

describe("loadBooks", () => {
  it("loads the default (BSB) books on their own", async () => {
    mockFetch();
    const { translation, books, englishBooks } = await loadBooks(new FreeUseBibleApi());
    expect(translation.id).toBe("BSB");
    expect(books).toHaveLength(66);
    expect(englishBooks).toEqual([]);
  });

  it("adds English names for another translation", async () => {
    mockFetch();
    const { translation, books, englishBooks } = await loadBooks(new FreeUseBibleApi(), "spa_r09");
    expect(translation.id).toBe("spa_r09");
    expect(books.find((b) => b.id === "JHN")?.commonName).toBe("Juan");
    expect(englishBooks.find((b) => b.id === "JHN")?.commonName).toBe("John");
  });

  it("lets a wrong translation ID fail as a normal error", async () => {
    mockFetch();
    const error = await loadBooks(new FreeUseBibleApi(), "bsb").catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UserFacingError);
  });
});

describe("findBook", () => {
  it("finds a book by its USFM code", async () => {
    expect(findBook(await booksOf("spa_r09"), "JHN")).toMatchObject({ id: "JHN", commonName: "Juan" });
  });

  it("says when the translation doesn't include the book", async () => {
    const books = await booksOf("spa_r09");
    expect(() => findBook(books, "JUD")).toThrow(new UserFacingError(`That translation doesn't include the book "JUD".`));
  });

  it("only accepts exact codes", async () => {
    const books = await booksOf("BSB");
    expect(() => findBook(books, "jhn")).toThrow(UserFacingError);
    expect(() => findBook(books, "John")).toThrow(UserFacingError);
  });
});
