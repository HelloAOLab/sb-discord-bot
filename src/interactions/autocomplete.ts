import type { APIApplicationCommandOptionChoice } from "discord-api-types/v10";
import { bibleApi } from "../bible/api.js";
import { describeTranslation, searchTranslations } from "../bible/translations.js";
import { describeUiLanguage, findUiLanguage, searchUiLanguages } from "../seedbible/ui-languages.js";
import { TIME_ZONES, allTimeZones, describeOffset, utcOffsetMinutes } from "../sessions/time.js";
import { truncate } from "../utils/text.js";

// Suggestions for options that several commands share (/open, /preferences). Each returns at most
// 25 choices, Discord's limit.

type Choice = APIApplicationCommandOptionChoice<string>;

/** Bible translations matching what's typed: "BSB · Berean Standard Bible (English)". */
export async function translationChoices(typed: string): Promise<Choice[]> {
  const { translations } = await bibleApi.getAvailableTranslations();
  return searchTranslations(translations, typed).map((translation) => ({
    name: truncate(describeTranslation(translation), 100),
    value: translation.id,
  }));
}

/** Seed Bible interface languages, the user's Discord language first: "Spanish (español) · es". */
export function uiLanguageChoices(typed: string, locale: string | undefined): Choice[] {
  const preferred = findUiLanguage(locale ?? "")?.code;
  return searchUiLanguages(typed, preferred).map((language) => ({
    name: truncate(`${describeUiLanguage(language)} · ${language.code}`, 100),
    value: language.code,
  }));
}

/**
 * Time zones matching what's typed, by ID ("America/New_York", "new york") or by the picker's
 * labels ("eastern"). With nothing typed, the picker's list.
 */
export function timeZoneChoices(typed: string, now = Math.floor(Date.now() / 1000)): Choice[] {
  const wanted = typed.trim().toLowerCase().replace(/[\s_]+/g, " ");
  const label = (id: string) => TIME_ZONES.find((zone) => zone.id === id)?.label;
  const candidates = wanted === "" ? TIME_ZONES.map((zone) => zone.id) : [...new Set([...TIME_ZONES.map((zone) => zone.id), ...allTimeZones()])];

  const score = (id: string): number => {
    if (wanted === "") return 0;
    const names = [id, label(id) ?? ""].map((name) => name.toLowerCase().replace(/[\s_]+/g, " "));
    const parts = names.flatMap((name) => name.split(/[/(),]\s*/));
    if (names.includes(wanted)) return 0;
    if (parts.some((part) => part.startsWith(wanted))) return 1;
    if (names.some((name) => name.includes(wanted))) return 2;
    return Infinity;
  };

  return candidates
    .map((id, index) => ({ id, index, score: score(id) }))
    .filter((entry) => entry.score !== Infinity)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, 25)
    .map(({ id }) => {
      const name = label(id);
      const offset = describeOffset(utcOffsetMinutes(now, id));
      return { name: truncate(name ? `${name} · ${id} (${offset})` : `${id} (${offset})`, 100), value: id };
    });
}
