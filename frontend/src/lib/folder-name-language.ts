import type { FolderNameLanguagePreference, StrategyLanguage } from "@/types/session";

export const FOLDER_NAME_LANGUAGE_OPTIONS: Array<{
  id: FolderNameLanguagePreference;
  label: string;
}> = [
  { id: "auto", label: "跟随界面语言" },
  { id: "zh", label: "中文" },
  { id: "en", label: "英文" },
];

export function isFolderNameLanguagePreference(value: unknown): value is FolderNameLanguagePreference {
  return value === "auto" || value === "zh" || value === "en";
}

export function resolveFolderNameLanguage(
  preference: FolderNameLanguagePreference | StrategyLanguage | null | undefined,
  uiLanguage: string | null | undefined,
): StrategyLanguage {
  if (preference === "zh" || preference === "en") {
    return preference;
  }
  return /^en(?:-|$)/i.test(String(uiLanguage || "").trim()) ? "en" : "zh";
}
