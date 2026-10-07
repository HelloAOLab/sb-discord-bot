import { describe, expect, it } from "vitest";
import { ButtonStyle, ComponentType } from "discord-api-types/v10";
import { FreeUseBibleApi } from "free-use-bible-api";
import { openMessage, resolveOpenLink } from "../../src/interactions/open-link.js";
import { UserFacingError } from "../../src/utils/errors.js";
import { mockFetch } from "../helpers/bible-api.js";

/** resolveOpenLink with a fresh, uncached API client. */
const resolve = (input: { book: string; chapter?: number; translation?: string }) => {
  mockFetch();
  return resolveOpenLink(input, new FreeUseBibleApi());
};

describe("resolveOpenLink", () => {
  it.each<[Parameters<typeof resolve>[0], string, object]>([
    [{ book: "JHN", chapter: 3 }, "John 3", { book: "JHN", chapter: 3 }],
    [{ book: "JHN" }, "John", { book: "JHN", chapter: 1 }],
    [{ book: "1CO", chapter: 13 }, "1 Corinthians 13", { book: "1CO", chapter: 13 }],
    [{ book: "JHN", chapter: 3, translation: "bsb" }, "John 3 (BSB)", { book: "JHN", chapter: 3, translation: "BSB" }],
    [{ book: "JHN", chapter: 3, translation: "kjv" }, "John 3 (KJAV)", { book: "JHN", chapter: 3, translation: "eng_kjv" }],
    [{ book: "JHN", chapter: 3, translation: "spa_r09" }, "Juan 3 (R09)", { book: "JHN", chapter: 3, translation: "spa_r09" }],
  ])("resolves %j", async (input, description, target) => {
    const link = await resolve(input);
    expect(link.description).toBe(description);
    expect(link.target).toEqual({ translation: undefined, ...target });
  });

  it.each<[Parameters<typeof resolve>[0], string | RegExp]>([
    [{ book: "JHN", chapter: 30 }, "John has chapters 1–21."],
    [{ book: "JHN", chapter: Number.NaN }, "John has chapters 1–21."],
    [{ book: "JHN", chapter: 2.5 }, "John has chapters 1–21."],
    [{ book: "JUD", chapter: 2 }, "Jude has only one chapter."],
    [{ book: "JUD", translation: "spa_r09" }, `That translation doesn't include the book "JUD".`],
    [{ book: "JHN", translation: "RVR" }, /couldn't find a translation called "RVR"/],
    [{ book: "John" }, `That translation doesn't include the book "John".`],
  ])("explains what's wrong with %j", async (input, message) => {
    await expect(resolve(input)).rejects.toThrow(message instanceof RegExp ? message : new UserFacingError(message));
  });
});

describe("openMessage", () => {
  it("says what opens and links to it", () => {
    expect(openMessage({ target: { book: "JHN", chapter: 3 }, description: "John 3" })).toEqual({
      content: "Open John 3 in Seed Bible:",
      components: [{
        type: ComponentType.ActionRow,
        components: [{
          type: ComponentType.Button,
          style: ButtonStyle.Link,
          label: "Open →",
          url: "https://seedbible.org/?book=JHN&chapter=3&source=discord_bot",
        }],
      }],
      allowed_mentions: { parse: [] },
    });
  });

  it("writes the address out instead of a button when buttons are off", () => {
    expect(openMessage({ target: { book: "JHN", chapter: 3 }, description: "John 3" }, { button: false })).toEqual({
      content: "Open John 3 in Seed Bible: <https://seedbible.org/?book=JHN&chapter=3&source=discord_bot>",
      allowed_mentions: { parse: [] },
    });
  });

  it("says just 'Open Seed Bible' without a description", () => {
    expect(openMessage({ target: {} }).content).toBe("Open Seed Bible:");
  });
});
