import { afterEach, describe, expect, it } from "vitest";

import i18n from "@/i18n/instance";
import type { SettingsTestResult } from "@/types/settings";
import { getSettingsTestIssueHint, getSettingsTestMessage } from "./diagnostics";

describe("settings diagnostics localization", () => {
  afterEach(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  it("localizes successful and incomplete tests by family", async () => {
    await i18n.changeLanguage("en");
    expect(getSettingsTestMessage({ status: "ok", family: "vision", code: "ok", message: "后端中文" }, i18n.t)).toBe(
      "The vision model read the text in the test image.",
    );
    expect(getSettingsTestMessage({ status: "error", family: "text", code: "incomplete_config", message: "后端中文" }, i18n.t)).toBe(
      "Text model configuration is incomplete. Enter the endpoint URL, model ID, and API key.",
    );
  });

  it("uses error codes instead of backend messages to choose copy", async () => {
    await i18n.changeLanguage("en");
    const result: SettingsTestResult = {
      status: "error",
      family: "text",
      code: "network_blocked",
      message: "本机网络层阻止了这次连接请求",
    };

    expect(getSettingsTestMessage(result, i18n.t)).toContain("local network blocked");
    expect(getSettingsTestMessage({ ...result, code: "future_code" }, i18n.t)).toBe(
      "The connection test failed. Check the configuration and network.",
    );
    expect(getSettingsTestIssueHint(result, i18n.t)).toContain("Windows firewall");
    expect(getSettingsTestIssueHint({ ...result, code: "future_code", message: "timeout" }, i18n.t)).toBe(
      "The request did not complete. Check the configuration using the error code above.",
    );
  });
});
