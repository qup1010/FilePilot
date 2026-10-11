import { describe, expect, it } from "vitest";

import { resolveFolderNameLanguage } from "./folder-name-language";

describe("resolveFolderNameLanguage", () => {
  it("follows the resolved app language when automatic", () => {
    expect(resolveFolderNameLanguage("auto", "en")).toBe("en");
    expect(resolveFolderNameLanguage("auto", "en-US")).toBe("en");
    expect(resolveFolderNameLanguage("auto", "zh-CN")).toBe("zh");
    expect(resolveFolderNameLanguage("auto", "fr-FR")).toBe("zh");
  });

  it("keeps an explicit folder-name language independent of the app language", () => {
    expect(resolveFolderNameLanguage("zh", "en")).toBe("zh");
    expect(resolveFolderNameLanguage("en", "zh-CN")).toBe("en");
  });
});
