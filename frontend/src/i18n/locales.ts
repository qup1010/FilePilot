export type UiLanguagePreference = "system" | "zh-CN" | "en";
export type ResolvedUiLocale = "zh-CN" | "en";

export const UI_LANGUAGE_STORAGE_KEY = "filepilot-ui-language";
export const DEFAULT_UI_LANGUAGE: UiLanguagePreference = "system";

export function isUiLanguagePreference(value: unknown): value is UiLanguagePreference {
  return value === "system" || value === "zh-CN" || value === "en";
}

export function resolveSystemUiLocale(languages?: readonly string[] | null): ResolvedUiLocale {
  const preferences = languages?.length
    ? languages
    : typeof navigator === "undefined"
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language];

  for (const language of preferences) {
    const normalized = String(language || "").trim().toLowerCase();
    if (normalized === "en" || normalized.startsWith("en-")) return "en";
    if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
  }
  return "zh-CN";
}

export function resolveUiLocale(preference: UiLanguagePreference, languages?: readonly string[] | null): ResolvedUiLocale {
  return preference === "system" ? resolveSystemUiLocale(languages) : preference;
}

export function normalizeSavedUiLanguage(value: unknown): UiLanguagePreference {
  return isUiLanguagePreference(value) ? value : DEFAULT_UI_LANGUAGE;
}
