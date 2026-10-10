import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n/instance";
import { invokeTauriCommandOrThrow } from "./runtime";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("strict Tauri command invocation", () => {
  afterEach(async () => {
    invokeMock.mockReset();
    await i18n.changeLanguage("zh-CN");
  });

  it("returns successful command results", async () => {
    invokeMock.mockResolvedValue({ status: "ok" });

    await expect(invokeTauriCommandOrThrow("test_command", { value: 1 }, "fallback"))
      .resolves.toEqual({ status: "ok" });
    expect(invokeMock).toHaveBeenCalledWith("test_command", { value: 1 });
  });

  it("maps structured native failures and preserves diagnostic details", async () => {
    await i18n.changeLanguage("en");
    invokeMock.mockRejectedValue(JSON.stringify({
      code: "TAURI_PATH_NOT_FOUND",
      params: { path: "D:/missing" },
      detail: "原始系统错误",
    }));

    await expect(invokeTauriCommandOrThrow("test_command", undefined, "fallback"))
      .rejects.toMatchObject({
        name: "UserFacingError",
        message: "Could not find D:/missing.",
        code: "TAURI_PATH_NOT_FOUND",
        rawMessage: "原始系统错误",
      });
  });
});
