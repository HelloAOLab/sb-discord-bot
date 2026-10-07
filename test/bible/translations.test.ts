import { describe, expect, it, vi } from "vitest";
import { FreeUseBibleApi } from "free-use-bible-api";
import { describeTranslation, findTranslation, searchTranslations } from "../../src/bible/translations.js";
import { UserFacingError } from "../../src/utils/errors.js";
import { mockFetch, translations } from "../helpers/bible-api.js";

const find = (input: string) => findTranslation(new FreeUseBibleApi(), input);

describe("findTranslation", () => {
  it.each([
    ["BSB", "BSB"],
    ["bsb", "BSB"],
    ["eng_kjv", "eng_kjv"],
    ["ENG_KJV", "eng_kjv"],
    ["R09", "spa_r09"],
    ["WEB", "ENGWEBP"],
    ["Berean Standard Bible", "BSB"],
    ["  BSB  ", "BSB"],
  ])("finds %j as %s", async (input, id) => {
    mockFetch();
    expect((await find(input)).id).toBe(id);
  });

  // Both eng_kjv and tha_kjv end in "kjv", and tha_kjv's short name is "KJV".
  it("prefers the English translation when a code is shared", async () => {
    mockFetch();
    expect((await find("kjv")).id).toBe("eng_kjv");
  });

  it("asks the user to pick when several English translations share a short name", async () => {
    mockFetch();
    await expect(find("WEBBE")).rejects.toThrow(
      /"WEBBE" matches more than one translation: `eng_webpb` \(.*\), `eng_weu` \(.*\)\. Pick one/,
    );
  });

  it("matches the ID without its language prefix before the short name", async () => {
    mockFetch();
    // eng_web's short name is also WEBC, but eng_webc's ID is the closer match.
    expect((await find("webc")).id).toBe("eng_webc");
  });

  it("explains when no translation matches", async () => {
    mockFetch();
    await expect(find("RVR")).rejects.toThrow(new UserFacingError(
      `I couldn't find a translation called "RVR". Pick one from the list as you type, e.g. \`BSB\`.`,
    ));
  });

  it("lets a failed API request through as a normal error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    const error = await find("BSB").catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UserFacingError);
  });
});

describe("searchTranslations", () => {
  const ids = (query: string) => searchTranslations(translations, query).map((t) => t.id);

  it("puts an exact code match first", () => {
    expect(ids("kjv").slice(0, 2)).toEqual(["eng_kjv", "tha_kjv"]);
    expect(ids("R09")[0]).toBe("spa_r09");
  });

  it("matches names and languages", () => {
    expect(ids("berean")).toEqual(["BSB"]);
    expect(ids("spanish")).toEqual(["spa_r09", "spa_rvg"]);
  });

  it("lists English translations first when nothing is typed", () => {
    expect(ids("").at(-1)).not.toMatch(/^eng|BSB|ENGWEBP/);
    expect(ids("")[0]).toBe("BSB");
  });

  it("returns at most the limit", () => {
    expect(searchTranslations(translations, "", 3)).toHaveLength(3);
  });

  it("returns nothing for an unknown query", () => {
    expect(ids("zzz")).toEqual([]);
  });

  it("describes a translation by short name, name and language", () => {
    expect(describeTranslation(translations[0]!)).toBe("BSB · Berean Standard Bible (English)");
  });
});
