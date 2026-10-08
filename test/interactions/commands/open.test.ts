import { describe, expect, it, vi } from "vitest";
import {
  ApplicationCommandOptionType,
  InteractionResponseType,
  MessageFlags,
  type APIApplicationCommandInteractionDataBasicOption,
} from "discord-api-types/v10";
import { open } from "../../../src/interactions/commands/open.js";
import { commands } from "../../../src/interactions/commands/index.js";
import { runDeferredWork } from "../../../src/interactions/deferred.js";
import { bibleApi } from "../../../src/bible/api.js";
import { UserFacingError } from "../../../src/utils/errors.js";
import { setSeedBibleLinksEnabled } from "../../../src/storage/guild-settings.js";
import { autocompleteInteraction, chatInputInteraction, opt } from "../../helpers/interactions.js";
import { mockFetch } from "../../helpers/bible-api.js";

interface Input {
  translation?: string;
  lang?: string;
}

const toOptions = (input: Input) => Object.entries(input).map(([name, value]) => opt.string(name, value));

/** Runs /open with the given options and returns its immediate response. */
const run = (input: Input = {}) => open.execute(chatInputInteraction("open", toOptions(input)));

/** Runs /open and returns the picker it edits into its private "thinking" message. */
async function picker(input: Input) {
  const { discordCalls } = mockFetch();
  const response = await run(input);
  expect(response).toEqual({
    type: InteractionResponseType.DeferredChannelMessageWithSource,
    data: { flags: MessageFlags.Ephemeral },
  });
  await runDeferredWork(response);
  expect(discordCalls).toHaveLength(1);
  expect(discordCalls[0]).toMatchObject({ method: "PATCH", url: expect.stringMatching(/\/messages\/(@|%40)original$/) });
  return discordCalls[0]!.body;
}

describe("/open", () => {
  describe("definition", () => {
    it("is registered as 'open'", () => {
      expect(commands.get("open")).toBe(open);
    });

    it("has only optional translation and lang options, with suggestions", () => {
      expect(open.data.options).toEqual([
        expect.objectContaining({ name: "translation", type: ApplicationCommandOptionType.String, autocomplete: true }),
        expect.objectContaining({ name: "lang", type: ApplicationCommandOptionType.String, autocomplete: true }),
      ]);
      expect(open.data.options?.some((o) => "required" in o && o.required)).toBe(false);
    });

    it("leaves book and chapter to the picker", () => {
      const names = open.data.options?.map((o) => o.name);
      expect(names).not.toContain("book");
      expect(names).not.toContain("chapter");
    });
  });

  describe("shows the private book picker", () => {
    it("starts on the first page of books", async () => {
      const message = await picker({});
      expect(message.content).toMatch(/^Choose a book\./);
      expect(message.components[0].components[0].custom_id).toBe("open-picker:book::::0:0");
      expect(message.components[0].components[0].options[0]).toMatchObject({ label: "Genesis", value: "GEN" });
    });

    it("treats blank options as not given", async () => {
      expect((await picker({ translation: " ", lang: "" })).components[0].components[0].custom_id).toBe(
        "open-picker:book::::0:0",
      );
    });

    it("carries the interface language into the picker", async () => {
      const message = await picker({ lang: "Spanish" });
      expect(message.components[0].components[0].custom_id).toBe("open-picker:book::es::0:0");
      expect(message.content).toContain("Seed Bible in Spanish (español)");
    });

    it("finds the exact translation and lists its books", async () => {
      const message = await picker({ translation: "R09" });
      expect(message.content).toContain("Translation: R09");
      expect(message.components[0].components[0].custom_id).toBe("open-picker:book:spa_r09:::0:0");
      expect(message.components[0].components[0].options[0]).toMatchObject({ label: "Génesis", description: "Genesis" });
    });
  });

  describe("when a server admin turned Seed Bible link buttons off", () => {
    it("still shows the picker, with the shortcut as a text link instead of a button", async () => {
      await setSeedBibleLinksEnabled("300000000000000001", false);
      const message = await picker({});
      expect(message.components).toHaveLength(1); // just the book menu
      expect(message.components[0].components[0].custom_id).toBe("open-picker:book::::0:0");
      expect(message.content).toContain("-# Or open Seed Bible now: <https://seedbible.org/?source=discord_bot>");
    });

    it("keeps the button in other servers", async () => {
      await setSeedBibleLinksEnabled("300000000000000999", false);
      const message = await picker({});
      expect(message.components.at(-1).components[0]).toMatchObject({ label: "Open Seed Bible →" });
    });
  });

  describe("problems", () => {
    it("rejects an interface language Seed Bible doesn't have, straight away", async () => {
      await expect(run({ lang: "xx" })).rejects.toThrow(new UserFacingError(
        `Seed Bible isn't available in "xx". Pick a language from the list as you type, e.g. \`es\` for Spanish.`,
      ));
    });

    it("explains privately when the translation doesn't exist", async () => {
      const { discordCalls } = mockFetch();
      await runDeferredWork(await run({ translation: "RVR" }));

      expect(discordCalls.map((c) => c.method)).toEqual(["DELETE", "POST"]);
      expect(discordCalls[1]!.body).toMatchObject({ flags: MessageFlags.Ephemeral, content: expect.stringContaining('"RVR"') });
    });

    it("sends a generic private error when the Bible API is down", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(bibleApi, "getTranslationBooks").mockRejectedValue(new Error("Failed request. Status: 503"));
      const { discordCalls } = mockFetch();

      await runDeferredWork(await run());

      expect(discordCalls.at(-1)!.body).toMatchObject({
        content: "Something went wrong. Please try again.",
        flags: MessageFlags.Ephemeral,
      });
    });
  });

  describe("autocomplete", () => {
    const suggest = (focused: APIApplicationCommandInteractionDataBasicOption, overrides = {}) =>
      open.autocomplete!(autocompleteInteraction("open", [focused], overrides));

    it("suggests translations by code or name, with the exact ID as the value", async () => {
      mockFetch();
      expect(await suggest(opt.focused("translation", "berean"))).toEqual([
        { name: "BSB · Berean Standard Bible (English)", value: "BSB" },
      ]);
    });

    it("suggests interface languages, the user's own first", async () => {
      const choices = await suggest(opt.focused("lang", ""), { locale: "es-ES" });
      expect(choices[0]).toEqual({ name: "Spanish (español) · es", value: "es" });
      expect(choices).toHaveLength(25);
    });

    it("suggests nothing for an unknown option", async () => {
      expect(await suggest(opt.focused("book", "Jo"))).toEqual([]);
    });

    it("keeps every suggestion within Discord's limits", async () => {
      mockFetch();
      for (const choices of [await suggest(opt.focused("translation", "")), await suggest(opt.focused("lang", ""))]) {
        expect(choices.length).toBeGreaterThan(0);
        expect(choices.length).toBeLessThanOrEqual(25);
        for (const choice of choices) {
          expect(choice.name.length).toBeLessThanOrEqual(100);
          expect(String(choice.value).length).toBeLessThanOrEqual(100);
        }
      }
    });
  });
});
