import type { ContentLocale } from "@/types/session";

export function contentLocaleForUiLanguage(language: string | null | undefined): ContentLocale {
  return /^en(?:-|$)/i.test(String(language || "").trim()) ? "en" : "zh-CN";
}
