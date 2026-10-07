import { describe, expect, it } from "vitest";
import {
  describeUiLanguage,
  findUiLanguage,
  searchUiLanguages,
  UI_LANGUAGES,
  uiLanguages,
} from "../../src/seedbible/ui-languages.js";

describe("seedbible.org interface languages", () => {
  it("has a readable English name for every language", () => {
    for (const language of uiLanguages) {
      expect(language.englishName, language.code).not.toBe(language.code);
    }
  });

  it.each([
    ["es", "es"],
    ["ES", "es"],
    ["pt-BR", "pt"],
    ["zh_TW", "zh"],
    ["Spanish", "es"],
    ["español", "es"],
    ["Indonesian", "ind"],
    ["fil", "fil"],
  ])("finds %j as %s", (input, code) => {
    expect(findUiLanguage(input)?.code).toBe(code);
  });

  it("returns null for a language the site doesn't have", () => {
    expect(findUiLanguage("xx")).toBeNull();
    expect(findUiLanguage("Klingon")).toBeNull();
  });

  it("suggests the user's own language first when nothing is typed", () => {
    expect(searchUiLanguages("", "es")[0]?.code).toBe("es");
    expect(searchUiLanguages("")).toHaveLength(25);
  });

  it("matches codes and names in either language", () => {
    expect(searchUiLanguages("span").map((l) => l.code)).toEqual(["es"]);
    expect(searchUiLanguages("deutsch").map((l) => l.code)).toEqual(["de"]);
    expect(searchUiLanguages("fr")[0]?.code).toBe("fr");
  });

  it("describes a language in English and in itself", () => {
    expect(describeUiLanguage(findUiLanguage("es")!)).toBe("Spanish (español)");
    expect(describeUiLanguage(findUiLanguage("en")!)).toBe("English");
  });

  it("has no duplicate codes", () => {
    expect(new Set(UI_LANGUAGES).size).toBe(UI_LANGUAGES.length);
  });
});
