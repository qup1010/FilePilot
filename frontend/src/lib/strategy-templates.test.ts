import { describe, expect, it } from "vitest";

import { getLaunchStrategyFromConfig } from "./strategy-templates";

describe("getLaunchStrategyFromConfig", () => {
  it("resolves an automatic folder-name language from the app language", () => {
    expect(getLaunchStrategyFromConfig({ LAUNCH_DEFAULT_LANGUAGE: "auto" }, "en")).toMatchObject({
      language: "en",
      language_preference: "auto",
    });
    expect(getLaunchStrategyFromConfig({ LAUNCH_DEFAULT_LANGUAGE: "auto" }, "zh-CN")).toMatchObject({
      language: "zh",
      language_preference: "auto",
    });
  });

  it("preserves saved explicit language preferences", () => {
    expect(getLaunchStrategyFromConfig({ LAUNCH_DEFAULT_LANGUAGE: "zh" }, "en")).toMatchObject({
      language: "zh",
      language_preference: "zh",
    });
    expect(getLaunchStrategyFromConfig({ LAUNCH_DEFAULT_LANGUAGE: "en" }, "zh-CN")).toMatchObject({
      language: "en",
      language_preference: "en",
    });
  });
});
