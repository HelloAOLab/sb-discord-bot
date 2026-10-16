import { ApplicationCommandOptionType, InteractionResponseType, MessageFlags, type APIInteractionResponseCallbackData } from "discord-api-types/v10";
import { bibleApi } from "../../bible/api.js";
import { findTranslation } from "../../bible/translations.js";
import { SEED_BIBLE_DEFAULT_TRANSLATION } from "../../seedbible/links.js";
import { describeUiLanguage, findUiLanguage } from "../../seedbible/ui-languages.js";
import { findTimeZone } from "../../sessions/time.js";
import { setUserPreferences, userPreferences, type UserPreferences } from "../../storage/user-settings.js";
import { UserFacingError } from "../../utils/errors.js";
import { timeZoneChoices, translationChoices, uiLanguageChoices } from "../autocomplete.js";
import { deferReply } from "../deferred.js";
import { interactionUserId } from "../user.js";
import type { Command } from "./types.js";

// /preferences [translation] [lang] [timezone] [reset] saves the user's own preferences, used for
// their reading-session links (/launchsession) and its time picker. They follow the user across
// servers. Without options it shows them. Replies are private.

export const preferences: Command = {
  data: {
    name: "preferences",
    description: "Your Bible translation, Seed Bible language and time zone for reading sessions",
    options: [
      { type: ApplicationCommandOptionType.String, name: "translation", description: "Bible translation, e.g. BSB", autocomplete: true, max_length: 100 },
      { type: ApplicationCommandOptionType.String, name: "lang", description: "Language of the Seed Bible interface, e.g. es", autocomplete: true, max_length: 50 },
      { type: ApplicationCommandOptionType.String, name: "timezone", description: "Your time zone, e.g. America/New_York", autocomplete: true, max_length: 100 },
      { type: ApplicationCommandOptionType.Boolean, name: "reset", description: "Forget all your preferences and use the defaults" },
    ],
  },

  async execute(interaction) {
    const userId = interactionUserId(interaction);
    const option = (name: string) => {
      const found = interaction.data.options?.find((o) => o.name === name);
      return found && "value" in found ? found.value : undefined;
    };
    const text = (name: string) => {
      const value = option(name);
      return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
    };
    const reset = option("reset") === true;

    if (reset) {
      await setUserPreferences(userId, { translation: null, lang: null, timeZone: null });
      return reply(summary({}, interaction.locale, "✅ Your preferences are reset to the defaults."));
    }

    // Checks that need no network come first, so a typo gets an instant reply.
    const changes: { [K in keyof UserPreferences]?: string } = {};
    const langInput = text("lang");
    if (langInput !== undefined) {
      const found = findUiLanguage(langInput);
      if (!found) throw new UserFacingError(`Seed Bible isn't available in "${langInput}". Pick a language from the list as you type, e.g. \`es\` for Spanish.`);
      changes.lang = found.code;
    }
    const zoneInput = text("timezone");
    if (zoneInput !== undefined) {
      const found = findTimeZone(zoneInput);
      if (!found) throw new UserFacingError(`I don't know the time zone "${zoneInput}". Pick one from the list as you type, e.g. \`America/New_York\`.`);
      changes.timeZone = found;
    }
    const translationInput = text("translation");

    const save = async () => {
      if (translationInput !== undefined) changes.translation = (await findTranslation(bibleApi, translationInput)).id;
      const changed = Object.keys(changes).length > 0;
      if (changed) await setUserPreferences(userId, changes);
      return summary(await userPreferences(userId), interaction.locale, changed ? "✅ Saved." : undefined);
    };

    // Checking a translation needs the Bible API's list, which may be slow on a cold cache.
    if (translationInput !== undefined) return deferReply(interaction, save, { ephemeral: true });
    return reply(await save());
  },

  async autocomplete(interaction) {
    const focused = interaction.data.options.find((option) => "focused" in option && option.focused);
    if (!focused || !("value" in focused)) return [];
    const typed = String(focused.value);
    if (focused.name === "translation") return translationChoices(typed);
    if (focused.name === "lang") return uiLanguageChoices(typed, interaction.locale);
    if (focused.name === "timezone") return timeZoneChoices(typed);
    return [];
  },
};

const reply = (data: APIInteractionResponseCallbackData) =>
  ({ type: InteractionResponseType.ChannelMessageWithSource, data: { ...data, flags: MessageFlags.Ephemeral } }) as const;

/** The user's preferences, with the defaults used for anything not set. */
function summary(saved: UserPreferences, locale: string | undefined, heading?: string): APIInteractionResponseCallbackData {
  const language = findUiLanguage(saved.lang ?? "");
  const discordLanguage = findUiLanguage(locale ?? "");
  const lines = [
    heading ?? "Your preferences:",
    `- **Bible translation:** ${saved.translation ?? `${SEED_BIBLE_DEFAULT_TRANSLATION} (the default)`}`,
    `- **Seed Bible language:** ${language ? describeUiLanguage(language) : `${discordLanguage ? describeUiLanguage(discordLanguage) : "English"} (from your Discord language)`}`,
    `- **Time zone:** ${saved.timeZone ?? "not set (the session time picker guesses, and remembers what you pick)"}`,
    "-# Used for your links to reading sessions (`/launchsession`). Change them with `/preferences`, or start over with `reset: True`.",
  ];
  return { content: lines.join("\n"), allowed_mentions: { parse: [] } };
}
