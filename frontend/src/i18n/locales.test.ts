import { describe, expect, it } from "vitest";

import { resolveSystemUiLocale, resolveUiLocale } from "./locales";

describe("UI locale resolution", () => {
  it("uses the first supported language in browser preference order", () => {
    expect(resolveSystemUiLocale(["fr-FR", "en-GB", "zh-CN"])).toBe("en");
    expect(resolveSystemUiLocale(["fr-FR", "zh-TW", "en"])).toBe("zh-CN");
  });

  it("falls back to Simplified Chinese when the system language is unsupported", () => {
    expect(resolveSystemUiLocale(["fr-FR", "ja-JP"])).toBe("zh-CN");
    expect(resolveUiLocale("en", ["zh-CN"])).toBe("en");
  });
});
