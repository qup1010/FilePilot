import { describe, expect, it } from "vitest";

import { normalizeSavedUiLanguage, resolveSystemUiLocale } from "./locales";

describe("UI locale defaults", () => {
  it("uses the system preference when no saved preference is present", () => {
    expect(normalizeSavedUiLanguage(undefined)).toBe("system");
    expect(normalizeSavedUiLanguage("invalid")).toBe("system");
  });

  it("resolves supported system languages and falls back to Simplified Chinese", () => {
    expect(resolveSystemUiLocale(["en-US"])).toBe("en");
    expect(resolveSystemUiLocale(["zh-TW"])).toBe("zh-CN");
    expect(resolveSystemUiLocale(["fr-FR"])).toBe("zh-CN");
  });
});
