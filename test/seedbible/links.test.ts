import { describe, expect, it } from "vitest";
import { seedBibleChapterUrl, seedBibleUrl } from "../../src/seedbible/links.js";

describe("seedBibleUrl", () => {
  it("links to the home page with only the source when nothing is chosen", () => {
    expect(seedBibleUrl()).toBe("https://seedbible.org/?source=discord_bot");
  });

  it("follows the URL schema from the issue", () => {
    expect(seedBibleUrl({ book: "JHN", chapter: 3, translation: "BSB" })).toBe(
      "https://seedbible.org/?book=JHN&chapter=3&translation=BSB&source=discord_bot",
    );
  });

  it("adds the interface language", () => {
    const url = new URL(seedBibleUrl({ book: "JHN", chapter: 3, translation: "spa_r09", lang: "en" }));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      book: "JHN",
      chapter: "3",
      translation: "spa_r09",
      lang: "en",
      source: "discord_bot",
    });
  });
});

describe("seedBibleChapterUrl", () => {
  it("links to a chapter with no language or translation, so Seed Bible uses the reader's own", () => {
    expect(seedBibleChapterUrl({ book: "Genesis", chapter: 2 })).toBe("https://seedbible.org/genesis/2?source=discord_bot");
  });

  it("adds the verses", () => {
    expect(seedBibleChapterUrl({ book: "Genesis", chapter: 2, verse: "3-4" })).toBe(
      "https://seedbible.org/genesis/2?verse=3-4&source=discord_bot",
    );
  });

  it("writes the book the way Seed Bible's addresses do", () => {
    expect(seedBibleChapterUrl({ book: "1 Corinthians", chapter: 13 })).toBe("https://seedbible.org/1-corinthians/13?source=discord_bot");
    expect(seedBibleChapterUrl({ book: "Song of Solomon", chapter: 2 })).toBe("https://seedbible.org/song-of-solomon/2?source=discord_bot");
  });
});
