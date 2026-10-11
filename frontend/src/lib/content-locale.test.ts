import { describe, expect, it } from "vitest";

import { contentLocaleForUiLanguage } from "./content-locale";

describe("contentLocaleForUiLanguage", () => {
  it("maps English UI locales to English and defaults other locales to Simplified Chinese", () => {
    expect(contentLocaleForUiLanguage("en")).toBe("en");
    expect(contentLocaleForUiLanguage("en-US")).toBe("en");
    expect(contentLocaleForUiLanguage("zh-CN")).toBe("zh-CN");
    expect(contentLocaleForUiLanguage(undefined)).toBe("zh-CN");
  });
});
