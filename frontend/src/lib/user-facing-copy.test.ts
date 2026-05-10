import { describe, expect, it } from "vitest";

import {
  UserFacingError,
  createUserFacingRequestError,
  getUserFacingErrorCode,
  localizeSessionLastError,
  localizeUserFacingError,
} from "./user-facing-copy";

describe("user-facing copy helpers", () => {
  it("maps API not-found errors to readable Chinese copy", () => {
    const error = createUserFacingRequestError(404, "Not Found", JSON.stringify({ detail: "SESSION_NOT_FOUND" }));

    expect(error.message).toBe("这条任务记录已不存在或已被删除。");
    expect(getUserFacingErrorCode(error)).toBe("SESSION_NOT_FOUND");
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

  it("maps unsafe source path errors to specific user-facing copy", () => {
    const error = createUserFacingRequestError(400, "Bad Request", JSON.stringify({ error_code: "SOURCE_PATH_SYSTEM_PROTECTED" }));

    expect(error.message).toBe("这个位置属于系统或软件配置目录，FilePilot 已阻止本次整理以避免破坏系统或应用。");
    expect(getUserFacingErrorCode(error)).toBe("SOURCE_PATH_SYSTEM_PROTECTED");
  });
});
