import { describe, expect, it } from "vitest";
import { seedBibleUrl } from "../../src/seedbible/links.js";

describe("seedBibleUrl", () => {
  it("links to the home page with only the source when nothing is chosen", () => {
    expect(seedBibleUrl()).toBe("https://seedbible.org/?source=discord_bot");
  });

  it("follows the URL schema from the issue", () => {
    expect(seedBibleUrl({ book: "JHN", chapter: 3, translation: "BSB" })).toBe(
      "https://seedbible.org/?book=JHN&chapter=3&translation=BSB&source=discord_bot",
    );
  });

  it("adds verses and the interface language", () => {
    const url = new URL(seedBibleUrl({ book: "JHN", chapter: 3, verses: "16-18", translation: "spa_r09", lang: "en" }));
    expect(Object.fromEntries(url.searchParams)).toEqual({
      book: "JHN",
      chapter: "3",
      verse: "16-18",
      translation: "spa_r09",
      lang: "en",
      source: "discord_bot",
    });
  });
});
