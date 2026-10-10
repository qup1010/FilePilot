import { afterEach, describe, expect, it } from "vitest";

import i18n from "@/i18n/instance";
import {
  UserFacingError,
  createUserFacingTauriCommandError,
  createUserFacingRequestError,
  getUserFacingErrorCode,
  localizeNativeCommandError,
  localizeSessionLastError,
  localizeUserFacingError,
} from "./user-facing-copy";

describe("user-facing copy helpers", () => {
  afterEach(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  it("maps API not-found errors to readable Chinese copy", () => {
    const error = createUserFacingRequestError(404, "Not Found", JSON.stringify({ detail: "SESSION_NOT_FOUND" }));

    expect(error.message).toBe("这条任务记录已不存在或已被删除。");
    expect(getUserFacingErrorCode(error)).toBe("SESSION_NOT_FOUND");
  });

  it("localizes machine-coded HTTP failures to the selected language", async () => {
    await i18n.changeLanguage("en");
    const error = createUserFacingRequestError(
      502,
      "Bad Gateway",
      JSON.stringify({ error_code: "SOME_NEW_BACKEND_CODE", message: "模型服务暂时不可用，请稍后再试。" }),
    );

    expect(error.message).toBe("The local service encountered an error. Try again shortly.");
    expect(error.message).not.toContain("模型服务");
    expect(error.rawMessage).toContain("模型服务暂时不可用，请稍后再试。");
    expect(getUserFacingErrorCode(error)).toBe("SOME_NEW_BACKEND_CODE");
  });

  it("maps network failures to a backend connection hint", () => {
    expect(localizeUserFacingError(new TypeError("Failed to fetch"), "fallback")).toBe(
      "暂时无法连接本地服务，请确认 FilePilot 后台仍在运行。",
    );
  });

  it("humanizes known session last_error values", () => {
    expect(localizeSessionLastError("scanning_interrupted")).toBe("扫描过程中已中断，请重新扫描后再继续。");
    expect(localizeSessionLastError("missing_execution_journal")).toBe("没有找到这次整理的执行记录。");
  });

  it("formats known session errors and local service fallbacks in English", async () => {
    await i18n.changeLanguage("en");

    expect(localizeSessionLastError("scanning_interrupted")).toBe("The scan was interrupted. Scan the folder again before continuing.");
    expect(localizeSessionLastError("missing_execution_journal")).toBe("The execution record for this task could not be found.");
    expect(localizeSessionLastError("unexpected_code")).toBe("The task was interrupted. Scan the folder again before continuing.");
    expect(localizeUserFacingError(new TypeError("Failed to fetch"), "fallback")).toBe(
      "Cannot connect to the local service. Make sure the FilePilot backend is running.",
    );
  });

  it("translates structured session errors and interruption stages", async () => {
    await i18n.changeLanguage("en");

    expect(localizeSessionLastError("原始后端错误", undefined, "scan_incomplete_items", { placeholder_count: 3 }))
      .toBe("3 items were not analyzed successfully. Try again or reduce parallelism.");
    expect(localizeSessionLastError("planning_interrupted", undefined, "planning_interrupted", { stage: "planning" }))
      .toBe("The task was interrupted during planning.");
  });

  it("humanizes model gateway timeout session errors", () => {
    expect(localizeSessionLastError("Error code: 504 - Gateway Timeout")).toBe(
      "模型服务响应超时，扫描已经停止。建议稍后重试，或在设置中切换到更稳定的模型服务。",
    );
  });

  it("falls back conservatively for unknown session issues", () => {
    expect(localizeSessionLastError("unexpected_code")).toBe("任务处理中断，请重新扫描后再继续。");
  });

  it("keeps explicit user-facing error messages", () => {
    const error = new UserFacingError("当前任务状态已变化，请刷新后重试。", { code: "SESSION_STAGE_CONFLICT", status: 409 });

    expect(localizeUserFacingError(error, "fallback")).toBe("当前任务状态已变化，请刷新后重试。");
  });

  it("maps backend error_code payloads to specific user-facing copy", () => {
    const error = createUserFacingRequestError(400, "Bad Request", JSON.stringify({ error_code: "TARGET_DIRECTORIES_REQUIRED" }));

    expect(error.message).toBe("归入已有目录时，请先选择至少一个目标目录。");
    expect(getUserFacingErrorCode(error)).toBe("TARGET_DIRECTORIES_REQUIRED");
  });

  it("maps review root placement conflicts to safety copy", () => {
    const error = createUserFacingRequestError(400, "Bad Request", JSON.stringify({ error_code: "REVIEW_ROOT_CONFLICT" }));

    expect(error.message).toBe("待确认区位置不能与新目录生成位置或目标目录重合、互相包含。请改选一个独立目录。");
    expect(getUserFacingErrorCode(error)).toBe("REVIEW_ROOT_CONFLICT");
  });

  it("maps unsafe source path errors to specific user-facing copy", () => {
    const error = createUserFacingRequestError(400, "Bad Request", JSON.stringify({ error_code: "SOURCE_PATH_SYSTEM_PROTECTED" }));

    expect(error.message).toBe("这个位置属于系统或软件配置目录，FilePilot 已阻止本次整理以避免破坏系统或应用。");
    expect(getUserFacingErrorCode(error)).toBe("SOURCE_PATH_SYSTEM_PROTECTED");
  });

  it("maps rule draft model errors to actionable Chinese copy", () => {
    const error = createUserFacingRequestError(
      502,
      "Bad Gateway",
      JSON.stringify({
        error_code: "RULE_DRAFTS_THINKING_TOOL_UNSUPPORTED",
        detail: "RULE_DRAFTS_THINKING_TOOL_UNSUPPORTED",
        message: "当前模型处于思考模式，不支持强制工具调用。请关闭 thinking，或换用支持工具调用的非思考模型。",
      }),
    );

    expect(error.message).toContain("思考模式");
    expect(getUserFacingErrorCode(error)).toBe("RULE_DRAFTS_THINKING_TOOL_UNSUPPORTED");
  });

  it("does not expose backend Chinese messages for unknown HTTP codes", async () => {
    await i18n.changeLanguage("en");
    const error = createUserFacingRequestError(
      502,
      "Bad Gateway",
      JSON.stringify({
        error_code: "SOME_NEW_BACKEND_CODE",
        message: "模型服务暂时不可用，请稍后再试。",
      }),
    );

    expect(error.message).toBe("The local service encountered an error. Try again shortly.");
  });

  it("localizes structured Tauri errors while keeping raw details for diagnostics", async () => {
    await i18n.changeLanguage("en");
    const error = createUserFacingTauriCommandError(
      JSON.stringify({
        code: "TAURI_PATH_NOT_FOUND",
        params: { path: "D:/Icons/Alpha" },
        detail: "路径不存在",
      }),
      "Could not apply the icon.",
    );

    expect(error.message).toBe("Could not find D:/Icons/Alpha.");
    expect(error.rawMessage).toBe("路径不存在");
    expect(getUserFacingErrorCode(error)).toBe("TAURI_PATH_NOT_FOUND");
  });

  it("uses the caller fallback for unknown Tauri error codes", async () => {
    await i18n.changeLanguage("en");

    const message = localizeNativeCommandError(
      "TAURI_FUTURE_ERROR",
      {},
      "Could not apply the icon.",
    );

    expect(message).toBe("Could not apply the icon.");
  });
});
