import type { ApiTranslation, FreeUseBibleApi } from "free-use-bible-api";
import { UserFacingError } from "../utils/errors.js";

const fold = (text: string) => text.trim().toLowerCase();

/** "eng_kjv" → "kjv". Most non-English IDs are "<ISO 639-3 language>_<code>". */
const withoutLanguagePrefix = (id: string) => id.replace(/^[a-z]{3}_/i, "");

/** "BSB · Berean Standard Bible (English)", the label shown in autocomplete and error messages. */
export function describeTranslation(translation: ApiTranslation): string {
  const language = translation.languageEnglishName ?? translation.language;
  return `${translation.shortName ?? translation.id} · ${translation.englishName} (${language})`;
}

/**
 * Finds the translation a user meant. IDs are case-sensitive in the API ("BSB" works, "bsb" is a
 * 404), so this always returns the exact entry from the API's list. Tries, in order:
 *   1. the exact ID ("eng_kjv"), then the ID in any case ("bsb")
 *   2. a short code: the short name ("WEB" → "ENGWEBP") or the ID without its language prefix
 *      ("kjv" → "eng_kjv"). Codes are often shared ("KJV" is also the Thai KJV's short name), so
 *      English translations win, then short-name matches, then ID matches.
 *   3. the full name ("Berean Standard Bible"), English ones first
 * If the best matches are still tied, the user is asked to pick.
 */
export async function findTranslation(api: FreeUseBibleApi, input: string): Promise<ApiTranslation> {
  const { translations } = await api.getAvailableTranslations();
  const wanted = fold(input);

  const exact = translations.find((t) => t.id === input.trim()) ?? only(translations.filter((t) => fold(t.id) === wanted));
  if (exact) return exact;

  const shortName = (t: ApiTranslation) => t.shortName !== undefined && fold(t.shortName) === wanted;
  const shortId = (t: ApiTranslation) => fold(withoutLanguagePrefix(t.id)) === wanted;
  const fullName = (t: ApiTranslation) => fold(t.englishName) === wanted || fold(t.name) === wanted;
  // Lower is better; each entry is compared in order.
  const notEnglish = (t: ApiTranslation) => (t.language === "eng" ? 0 : 1);

  const steps: { matches: (t: ApiTranslation) => boolean; rank: (t: ApiTranslation) => number[] }[] = [
    { matches: (t) => shortName(t) || shortId(t), rank: (t) => [notEnglish(t), shortName(t) ? 0 : 1, shortId(t) ? 0 : 1] },
    { matches: fullName, rank: (t) => [notEnglish(t)] },
  ];

  for (const { matches, rank } of steps) {
    const found = translations.filter(matches);
    if (found.length === 0) continue;

    const ranked = found.map((t) => ({ t, rank: rank(t) })).sort((a, b) => compareRanks(a.rank, b.rank));
    const best = ranked.filter((entry) => compareRanks(entry.rank, ranked[0]!.rank) === 0).map((entry) => entry.t);
    if (best.length === 1) return best[0]!;

    const options = best
      .slice(0, 5)
      .map((t) => `\`${t.id}\` (${describeTranslation(t)})`)
      .join(", ");
    throw new UserFacingError(
      `"${input}" matches more than one translation: ${options}. Pick one from the list as you type.`,
    );
  }

  throw new UserFacingError(
    `I couldn't find a translation called "${input}". Pick one from the list as you type, e.g. \`BSB\`.`,
  );
}

const only = <T>(items: T[]): T | undefined => (items.length === 1 ? items[0] : undefined);

function compareRanks(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return 0;
}

/**
 * Ranks translations for autocomplete: an exact ID or short name first, then names that start with
 * the query, then names that merely contain it. With an empty query, English translations come first.
 */
export function searchTranslations(translations: ApiTranslation[], query: string, limit = 25): ApiTranslation[] {
  const wanted = fold(query);

  const score = (t: ApiTranslation): number => {
    const codes = [t.id, withoutLanguagePrefix(t.id), t.shortName ?? ""].map(fold);
    const names = [t.englishName, t.name, t.languageEnglishName ?? "", t.languageName ?? ""].map(fold);
    if (wanted === "") return t.language === "eng" ? 1 : 2;
    if (codes.includes(wanted)) return 0;
    if (codes.some((c) => c.startsWith(wanted))) return 1;
    if (names.some((n) => n.startsWith(wanted))) return 2;
    if ([...codes, ...names].some((n) => n.includes(wanted))) return 3;
    return Infinity;
  };

  return translations
    .map((translation, index) => ({ translation, index, score: score(translation) }))
    .filter((entry) => entry.score !== Infinity)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.translation);
}
