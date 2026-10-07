// Languages the seedbible.org interface is translated into, set with the `lang` URL parameter.
// Copied from the site's locale files (one "<code>.json" per language). The codes are the site's
// own: most are ISO 639-1, but Indonesian is "ind", and Hebrew is available as both "he" and "iw".
// Update this list when seedbible.org adds a language.
export const UI_LANGUAGES = [
  "af", "am", "ar", "az", "be", "bg", "bn", "bs", "ca", "cs", "cy", "da", "de", "el", "en", "es",
  "et", "fa", "fi", "fil", "fr", "fy", "gl", "gn", "gu", "he", "hi", "hr", "hu", "ind", "is", "it",
  "iw", "ja", "ka", "km", "kn", "ko", "ky", "ln", "lo", "lt", "lv", "mk", "ml", "mn", "mr", "ms",
  "my", "nb", "ne", "nl", "no", "pa", "pl", "ps", "pt", "ro", "ru", "sk", "sl", "sq", "sv", "sw",
  "ta", "te", "th", "ti", "tl", "tr", "ug", "uk", "ur", "uz", "vi", "zh", "zu",
] as const;

export type UiLanguage = (typeof UI_LANGUAGES)[number];

export interface UiLanguageInfo {
  code: UiLanguage;
  /** Name in English, e.g. "Spanish". */
  englishName: string;
  /** Name in the language itself, e.g. "español". */
  nativeName: string;
}

const englishNames = new Intl.DisplayNames(["en"], { type: "language", fallback: "code" });

export const uiLanguages: UiLanguageInfo[] = UI_LANGUAGES.map((code) => ({
  code,
  englishName: englishNames.of(code) ?? code,
  nativeName: new Intl.DisplayNames([code], { type: "language", fallback: "code" }).of(code) ?? code,
}));

const fold = (text: string) => text.trim().toLowerCase();

/**
 * Finds the interface language a user meant: a code ("es"), a regional code ("pt-BR" → "pt"),
 * or a name in English or the language itself ("Spanish", "español"). Returns null if unknown.
 */
export function findUiLanguage(input: string): UiLanguageInfo | null {
  const wanted = fold(input).replace(/_/g, "-");
  const base = wanted.split("-")[0]!;
  return (
    uiLanguages.find((l) => l.code === wanted) ??
    uiLanguages.find((l) => l.code === base) ??
    uiLanguages.find((l) => fold(l.englishName) === wanted || fold(l.nativeName) === wanted) ??
    null
  );
}

/**
 * Ranks interface languages for autocomplete. With an empty query, `preferred` (e.g. the user's
 * Discord locale) comes first and the rest follow alphabetically by English name.
 */
export function searchUiLanguages(query: string, preferred?: string, limit = 25): UiLanguageInfo[] {
  const wanted = fold(query);
  const score = (l: UiLanguageInfo): number => {
    const names = [l.englishName, l.nativeName].map(fold);
    if (wanted === "") return l.code === preferred ? 0 : 1;
    if (l.code === wanted) return 0;
    if (l.code.startsWith(wanted) || names.some((n) => n.startsWith(wanted))) return 1;
    if (names.some((n) => n.includes(wanted))) return 2;
    return Infinity;
  };

  return uiLanguages
    .map((language) => ({ language, score: score(language) }))
    .filter((entry) => entry.score !== Infinity)
    .sort((a, b) => a.score - b.score || a.language.englishName.localeCompare(b.language.englishName))
    .slice(0, limit)
    .map((entry) => entry.language);
}

/** "Spanish (español)", or just "English" when both names are the same. */
export function describeUiLanguage(language: UiLanguageInfo): string {
  return language.englishName === language.nativeName
    ? language.englishName
    : `${language.englishName} (${language.nativeName})`;
}
