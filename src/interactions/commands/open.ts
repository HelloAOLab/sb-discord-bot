import { ApplicationCommandOptionType } from "discord-api-types/v10";
import { bibleApi } from "../../bible/api.js";
import { loadBooks } from "../../bible/books.js";
import { describeTranslation, findTranslation, searchTranslations } from "../../bible/translations.js";
import { UserFacingError } from "../../utils/errors.js";
import { describeUiLanguage, findUiLanguage, searchUiLanguages } from "../../seedbible/ui-languages.js";
import { truncate } from "../../utils/text.js";
import { pickerMessage } from "../components/open-picker.js";
import { deferReply } from "../deferred.js";
import { seedBibleLinksEnabled } from "../../storage/guild-settings.js";
import type { Command } from "./types.js";

// /open [translation] [lang] shows a private picker (components/open-picker.ts) for choosing a
// book and chapter from dropdowns; choosing a chapter posts a public button that opens it on
// seedbible.org. `translation` picks the Bible text and `lang` the language of the Seed Bible
// interface; they're independent, optional, and suggest values as the user types.
// No Bible text is posted. Where /setseedbiblelinks turned links off, links are written out as
// text instead of shown as buttons.

export const open: Command = {
  data: {
    name: "open",
    description: "Choose a book and chapter to open in Seed Bible",
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: "translation",
        description: "Bible translation, e.g. BSB",
        autocomplete: true,
        max_length: 100,
      },
      {
        type: ApplicationCommandOptionType.String,
        name: "lang",
        description: "Language of the Seed Bible interface, e.g. es (separate from the translation)",
        autocomplete: true,
        max_length: 50,
      },
    ],
  },

  async execute(interaction) {
    const { translation, lang: langInput } = readInput(interaction.data.options);

    // Checking the interface language needs no network, so a typo gets an instant private reply.
    let lang: string | undefined;
    if (langInput !== undefined) {
      const found = findUiLanguage(langInput);
      if (!found) {
        throw new UserFacingError(
          `Seed Bible isn't available in "${langInput}". Pick a language from the list as you type, e.g. \`es\` for Spanish.`,
        );
      }
      lang = found.code;
    }

    // The picker lists book names from the Bible API, which may not answer within Discord's
    // 3 seconds on a cold cache, so reply "thinking…" (privately) first and edit it afterwards.
    return deferReply(
      interaction,
      async () => {
        const id = translation === undefined ? undefined : (await findTranslation(bibleApi, translation)).id;
        const buttons = seedBibleLinksEnabled(interaction.guild_id);
        return pickerMessage({ translation: id, lang }, await loadBooks(bibleApi, id), { buttons });
      },
      { ephemeral: true },
    );
  },

  async autocomplete(interaction) {
    const focused = interaction.data.options.find((option) => "focused" in option && option.focused);
    if (!focused || !("value" in focused)) return [];
    const typed = String(focused.value);

    if (focused.name === "translation") {
      const { translations } = await bibleApi.getAvailableTranslations();
      return searchTranslations(translations, typed).map((translation) => ({
        name: truncate(describeTranslation(translation), 100),
        value: translation.id,
      }));
    }

    if (focused.name === "lang") {
      const preferred = findUiLanguage(interaction.locale ?? "")?.code;
      return searchUiLanguages(typed, preferred).map((language) => ({
        name: truncate(`${describeUiLanguage(language)} · ${language.code}`, 100),
        value: language.code,
      }));
    }

    return [];
  },
};

/** Reads the /open options, treating blank text as not given. */
function readInput(options: readonly { name: string; value?: unknown }[] = []): { translation?: string; lang?: string } {
  const text = (name: string) => {
    const value = options.find((o) => o.name === name)?.value;
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  };
  return { translation: text("translation"), lang: text("lang") };
}
