import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ButtonStyle, ComponentType, InteractionResponseType, MessageFlags } from "discord-api-types/v10";
import { FreeUseBibleApi } from "free-use-bible-api";
import { openPicker, pickerMessage, type PickerState } from "../../../src/interactions/components/open-picker.js";
import { components } from "../../../src/interactions/components/index.js";
import { customId, parseCustomId } from "../../../src/interactions/components/custom-id.js";
import { runDeferredWork } from "../../../src/interactions/deferred.js";
import { bibleApi } from "../../../src/bible/api.js";
import { loadBooks } from "../../../src/bible/books.js";
import { UserFacingError } from "../../../src/utils/errors.js";
import { setSeedBibleLinksEnabled } from "../../../src/storage/guild-settings.js";
import { buttonInteraction, selectInteraction } from "../../helpers/interactions.js";
import { mockFetch } from "../../helpers/bible-api.js";

type Message = ReturnType<typeof pickerMessage>;
interface Menu {
  custom_id: string;
  placeholder: string;
  options: { label: string; value: string; default?: boolean; description?: string }[];
}

/** Draws the picker for `state` from the fake Bible API. */
async function draw(state: PickerState): Promise<Message> {
  mockFetch();
  return pickerMessage(state, await loadBooks(new FreeUseBibleApi(), state.translation));
}

/** Picks `value` from the menu with this custom_id, runs the deferred work, and returns what was sent to Discord. */
async function choose(menuCustomId: string, value: string) {
  const { discordCalls } = mockFetch();
  const response = await openPicker.execute(selectInteraction(menuCustomId, [value]), parseCustomId(menuCustomId).args);
  expect(response).toEqual({ type: InteractionResponseType.DeferredMessageUpdate });
  await runDeferredWork(response);
  return discordCalls;
}

/** Picks `value` and returns the redrawn picker (the PATCH to the picker's message). */
async function chooseAndRedraw(menuCustomId: string, value: string): Promise<Message> {
  const calls = await choose(menuCustomId, value);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ method: "PATCH", url: expect.stringMatching(/\/messages\/(@|%40)original$/) });
  return calls[0]!.body;
}

/** The select menus in a picker message, keyed by step ("book", "chapter"). */
function menus(message: Message): Record<string, Menu> {
  const found: Record<string, Menu> = {};
  for (const row of message.components ?? []) {
    for (const component of (row as any).components) {
      if (component.type === ComponentType.StringSelect) found[parseCustomId(component.custom_id).args[0]!] = component;
    }
  }
  return found;
}

const linkButton = (message: Message) => (message.components!.at(-1) as any).components[0];
const labels = (menu: Menu) => menu.options.map((o) => o.label);
const selected = (menu: Menu) => menu.options.find((o) => o.default)?.value;

/** custom_id of a picker menu: step, translation, lang, book, book page, chapter page. */
const id = (step: string, translation = "", lang = "", book = "", bookPage = 0, chapterPage = 0) =>
  customId("open-picker", step, translation, lang, book, bookPage, chapterPage);

describe("open-picker", () => {
  describe("wiring", () => {
    it("is registered under the id its menus' custom_ids start with", async () => {
      expect(components.get("open-picker")).toBe(openPicker);
      expect(menus(await draw({})).book!.custom_id).toBe("open-picker:book::::0:0");
    });

    it("carries the translation, interface language, book and pages in every menu", async () => {
      const message = await chooseAndRedraw(id("book", "spa_r09", "es"), "JHN");
      expect(menus(message).book!.custom_id).toBe("open-picker:book:spa_r09:es:JHN:0:0");
      expect(menus(message).chapter!.custom_id).toBe("open-picker:chapter:spa_r09:es:JHN:0:0");
    });
  });

  describe("choosing a book", () => {
    it("shows the first 24 books, then 'Next →'", async () => {
      const message = await draw({});
      const book = menus(message).book!;

      expect(message.content).toBe("Choose a book. Pick **Next →** at the end of the list to see more books.");
      expect(book.placeholder).toBe("Book (page 1 of 3)");
      expect(book.options).toHaveLength(25);
      expect(labels(book).slice(0, 2)).toEqual(["Genesis", "Exodus"]);
      expect(book.options.at(-2)?.label).toBe("Jeremiah");
      expect(book.options.at(-1)).toEqual({ label: "Next →", description: "Lamentations – 2 Corinthians", value: "page:1" });
    });

    it("shows the next books when 'Next →' is chosen, with '← Previous' first", async () => {
      const message = await chooseAndRedraw(id("book"), "page:1");
      const book = menus(message).book!;

      expect(book.placeholder).toBe("Book (page 2 of 3)");
      expect(book.custom_id).toBe("open-picker:book::::1:0");
      expect(book.options[0]).toEqual({ label: "← Previous", description: "Genesis – Jeremiah", value: "page:0" });
      expect(book.options[1]?.label).toBe("Lamentations");
      expect(book.options.at(-1)).toMatchObject({ label: "Next →", value: "page:2" });
    });

    it("ends with Revelation on the last page, without 'Next →'", async () => {
      const book = menus(await chooseAndRedraw(id("book", "", "", "", 1), "page:2")).book!;
      expect(book.options[0]?.label).toBe("← Previous");
      expect(book.options.at(-1)?.label).toBe("Revelation");
    });

    it("can go back with '← Previous'", async () => {
      const book = menus(await chooseAndRedraw(id("book", "", "", "", 2), "page:1")).book!;
      expect(book.options[1]?.label).toBe("Lamentations");
    });

    it("names books in the translation's language with the English name underneath", async () => {
      const book = menus(await draw({ translation: "spa_r09" })).book!;
      expect(book.options).toContainEqual({ label: "Juan", description: "John", value: "JHN", default: false });
    });

    it("shows a page that fits in one menu without page options", async () => {
      const book = menus(await draw({ translation: "spa_r09" })).book!;
      expect(book.placeholder).toBe("Book");
      expect(book.options.some((o) => o.value.startsWith("page:"))).toBe(false);
    });
  });

  describe("choosing a chapter", () => {
    it("lists every chapter of a book with up to 25, keeping the book menu on its page", async () => {
      const message = await chooseAndRedraw(id("book", "", "", "", 1), "JHN");

      expect(message.content).toBe("Choose a chapter of **John**.");
      expect(selected(menus(message).book!)).toBe("JHN");
      expect(menus(message).book!.placeholder).toBe("Book (page 2 of 3)");
      expect(labels(menus(message).chapter!)).toEqual(Array.from({ length: 21 }, (_, i) => `John ${i + 1}`));
      expect(linkButton(message)).toMatchObject({ label: "Open John →", url: "https://seedbible.org/?book=JHN&chapter=1&source=discord_bot" });
    });

    it("pages through a long book", async () => {
      const first = await chooseAndRedraw(id("book"), "PSA");
      const chapter = menus(first).chapter!;
      expect(first.content).toBe("Choose a chapter of **Psalms**. Pick **Next →** at the end of the list to see more chapters.");
      expect(chapter.placeholder).toBe("Chapter (page 1 of 7)");
      expect(chapter.options.at(-1)).toEqual({ label: "Next →", description: "Psalms 25 – Psalms 47", value: "page:1" });

      const last = menus(await chooseAndRedraw(id("chapter", "", "", "PSA", 0, 5), "page:6")).chapter!;
      expect(last.custom_id).toBe("open-picker:chapter:::PSA:0:6");
      expect(labels(last)).toEqual(["← Previous", ...Array.from({ length: 11 }, (_, i) => `Psalms ${140 + i}`)]);
    });

    it("starts a newly chosen book's chapters on the first page", async () => {
      const message = await chooseAndRedraw(id("book", "", "", "PSA", 0, 6), "GEN");
      expect(labels(menus(message).chapter!)[0]).toBe("Genesis 1");
    });

    it("stays within Discord's limits of 5 rows and 25 options per menu on every page", async () => {
      for (let page = 0; page < 7; page++) {
        const message = await chooseAndRedraw(id("chapter", "", "", "PSA", 2, page), `page:${page}`);
        expect(message.components!.length).toBeLessThanOrEqual(5);
        for (const menu of Object.values(menus(message))) expect(menu.options.length).toBeLessThanOrEqual(25);
      }
    });
  });

  describe("posting the link", () => {
    it("posts the link publicly, then closes the picker", async () => {
      const calls = await choose(id("chapter", "", "", "JHN"), "3");

      expect(calls.map((c) => c.method)).toEqual(["POST", "PATCH"]);
      expect(calls[0]!.body).toEqual({
        content: "Open John 3 in Seed Bible:",
        components: [{
          type: ComponentType.ActionRow,
          components: [{ type: ComponentType.Button, style: ButtonStyle.Link, label: "Open →", url: "https://seedbible.org/?book=JHN&chapter=3&source=discord_bot" }],
        }],
        allowed_mentions: { parse: [] },
      });
      expect(calls[0]!.body.flags).toBeUndefined(); // public, not ephemeral
      expect(calls[1]!.body).toEqual({ content: "Posted a link to **John 3** below.", components: [], allowed_mentions: { parse: [] } });
    });

    it("includes the translation and interface language in the link", async () => {
      const [post] = await choose(id("chapter", "spa_r09", "en", "JHN"), "3");

      expect(post!.body.content).toBe("Open Juan 3 (R09) in Seed Bible:");
      expect(post!.body.components[0].components[0].url).toBe(
        "https://seedbible.org/?book=JHN&chapter=3&translation=spa_r09&lang=en&source=discord_bot",
      );
    });

    it("posts straight away for a book with only one chapter", async () => {
      const calls = await choose(id("book"), "JUD");

      expect(calls.map((c) => c.method)).toEqual(["POST", "PATCH"]);
      expect(calls[0]!.body.content).toBe("Open Jude 1 in Seed Bible:");
    });
  });

  describe("when a server admin turned Seed Bible link buttons off", () => {
    beforeEach(() => setSeedBibleLinksEnabled("300000000000000001", false));
    afterEach(() => setSeedBibleLinksEnabled("300000000000000001", true));

    it("posts the link as text instead of a button, with no preview card", async () => {
      const [post] = await choose(id("chapter", "spa_r09", "en", "JHN"), "3");

      expect(post!.body).toEqual({
        content: "Open Juan 3 (R09) in Seed Bible: <https://seedbible.org/?book=JHN&chapter=3&translation=spa_r09&lang=en&source=discord_bot>",
        allowed_mentions: { parse: [] },
      });
    });

    it("still works as usual otherwise, with the shortcut as a text link", async () => {
      const message = await chooseAndRedraw(id("book"), "JHN");

      expect(Object.keys(menus(message))).toEqual(["book", "chapter"]);
      expect(message.components).toHaveLength(2); // no button row
      expect(message.content).toBe(
        "Choose a chapter of **John**.\n-# Or open John now: <https://seedbible.org/?book=JHN&chapter=1&source=discord_bot>",
      );
    });

    it("applies to a picker opened before the setting changed", async () => {
      // The menus carry no record of the setting; it's read on each click.
      const calls = await choose(id("book"), "JUD");
      expect(calls[0]!.body.components).toBeUndefined();
      expect(calls[0]!.body.content).toContain("<https://seedbible.org/?book=JUD&chapter=1&source=discord_bot>");
    });
  });

  describe("bad or tampered input", () => {
    it.each([
      ["an unknown step", id("section"), "law"],
      ["a missing step", "open-picker", "3"],
      ["a chapter without a book", id("chapter"), "3"],
    ])("says the menu no longer works for %s", (_, menuId, value) => {
      expect(() => openPicker.execute(selectInteraction(menuId, [value]), parseCustomId(menuId).args)).toThrow(
        new UserFacingError("This menu no longer works. Please run `/open` again."),
      );
    });

    it("says the menu no longer works for a button click instead of a selection", () => {
      expect(() => openPicker.execute(buttonInteraction(id("book")), parseCustomId(id("book")).args)).toThrow(UserFacingError);
    });

    it("shows the nearest valid page for a garbled or out-of-range page", async () => {
      expect(menus(await chooseAndRedraw(id("book"), "page:99")).book!.placeholder).toBe("Book (page 3 of 3)");
      const garbled = "open-picker:book::::abc:-4";
      expect(menus(await chooseAndRedraw(garbled, "JHN")).book!.placeholder).toBe("Book (page 1 of 3)");
    });

    it("keeps the picker and explains privately when a chapter doesn't exist", async () => {
      const calls = await choose(id("chapter", "", "", "JHN"), "99");

      expect(calls.map((c) => c.method)).toEqual(["POST"]); // no PATCH or DELETE: the picker stays usable
      expect(calls[0]!.body).toMatchObject({ content: "John has chapters 1–21.", flags: MessageFlags.Ephemeral });
    });

    it("explains privately when the book doesn't exist", async () => {
      const calls = await choose(id("book"), "XYZ");
      expect(calls[0]!.body).toMatchObject({ content: expect.stringContaining('"XYZ"'), flags: MessageFlags.Ephemeral });
    });

    it("ignores an unknown interface language", async () => {
      const [post] = await choose(id("chapter", "", "xx", "JHN"), "3");
      expect(post!.body.components[0].components[0].url).not.toContain("lang=");
    });

    it("keeps the picker and shows a generic private error when the Bible API is down", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(bibleApi, "getTranslationBooks").mockRejectedValue(new Error("Failed request. Status: 503"));

      const calls = await choose(id("book"), "page:1");

      expect(calls.map((c) => c.method)).toEqual(["POST"]);
      expect(calls[0]!.body).toMatchObject({ content: "Something went wrong. Please try again.", flags: MessageFlags.Ephemeral });
    });
  });
});
