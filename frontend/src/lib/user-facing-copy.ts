export class UserFacingError extends Error {
  code?: string;
  status?: number;
  rawMessage?: string;

  constructor(message: string, options?: { code?: string; status?: number; rawMessage?: string }) {
    super(message);
    this.name = "UserFacingError";
    this.code = options?.code;
    this.status = options?.status;
    this.rawMessage = options?.rawMessage;
  }
}

function parseErrorPayload(errorText: string): { detail?: string; message?: string; error_code?: string } | null {
  const trimmed = String(errorText || "").trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "string") {
      return { detail: parsed };
    }
    if (parsed && typeof parsed === "object") {
      const detail = typeof parsed.detail === "string" ? parsed.detail : undefined;
      const message = typeof parsed.message === "string" ? parsed.message : undefined;
      const errorCode = typeof parsed.error_code === "string" ? parsed.error_code : undefined;
      return { detail, message, error_code: errorCode };
    }
  } catch {
    return { detail: trimmed };
  }
  return null;
}

function requestErrorMessage(status: number, detail?: string): string {
  const normalizedDetail = String(detail || "").trim().toUpperCase();
  if (normalizedDetail === "SESSION_NOT_FOUND") {
    return "这条任务记录已不存在或已被删除。";
  }
  if (normalizedDetail === "SESSION_STAGE_CONFLICT") {
    return "当前任务状态已变化，请刷新后重试。";
  }
  if (normalizedDetail === "SESSION_LOCKED") {
    return "当前任务正在被其他操作占用，请稍后再试。";
  }
  if (normalizedDetail === "CONFIRMATION_REQUIRED") {
    return "请先确认当前操作，再继续执行。";
  }
  if (normalizedDetail === "OUTPUT_DIR_REQUIRED" || normalizedDetail === "NEW_DIRECTORY_ROOT_REQUIRED") {
    return "请先指定新目录生成位置，再开始整理。";
  }
  if (normalizedDetail === "REVIEW_ROOT_REQUIRED") {
    return "请先指定待确认区位置，再开始整理。";
  }
  if (normalizedDetail === "REVIEW_ROOT_CONFLICT") {
    return "待确认区位置不能与新目录生成位置或目标目录重合、互相包含。请改选一个独立目录。";
  }
  if (normalizedDetail === "TARGET_DIRECTORIES_REQUIRED") {
    return "归入已有目录时，请先选择至少一个目标目录。";
  }
  if (normalizedDetail === "TARGET_PROFILE_NOT_FOUND") {
    return "当前目录配置已不存在，请重新选择目标目录配置。";
  }
  if (normalizedDetail === "SOURCE_PATH_DRIVE_ROOT") {
    return "不能直接整理磁盘根目录。请改选下载、桌面、照片或某个明确的个人资料文件夹。";
  }
  if (normalizedDetail === "SOURCE_PATH_SYSTEM_PROTECTED") {
    return "这个位置属于系统或软件配置目录，FilePilot 已阻止本次整理以避免破坏系统或应用。";
  }
  if (normalizedDetail === "SOURCE_PATH_PROJECT_ROOT") {
    return "不能直接整理 FilePilot 当前项目目录。请改选一个明确的待整理文件夹或单个文件。";
  }
  if (normalizedDetail === "SOURCE_PATH_EMPTY") {
    return "请先选择有效的整理来源。";
  }
  if (normalizedDetail === "INCREMENTAL_TARGET_NOT_ALLOWED") {
    return "归入已有目录时，只能移动到已选择的目标目录。";
  }
  if (normalizedDetail === "ABSOLUTE_TARGET_DIR_NOT_ALLOWED") {
    return "目标路径需要填写相对目录，不能直接填写绝对路径。";
  }
  if (normalizedDetail === "TARGET_DIR_OUTSIDE_ROOT") {
    return "目标路径不能跳出新目录生成位置，请填写它下面的相对目录。";
  }
  if (normalizedDetail === "REVIEW_SUBDIRECTORY_NOT_ALLOWED") {
    return "待确认区只作为统一暂存位置，不能再指定它的子目录。";
  }

  if (status === 401 || status === 403) {
    return "当前连接已失效，请重新启动应用后再试。";
  }
  if (status === 404) {
    return "这条任务记录已不存在或已被删除。";
  }
  if (status === 409) {
    return "当前任务状态已变化，请刷新后重试。";
  }
  if (status >= 500) {
    return "本地服务处理请求时出错，请稍后再试。";
  }
  if (status >= 400) {
    return "当前请求暂时无法完成，请刷新后重试。";
  }
  return "操作失败，请稍后再试。";
}

export function createUserFacingRequestError(status: number, statusText: string, errorText: string): UserFacingError {
  const payload = parseErrorPayload(errorText);
  const detail = payload?.detail || payload?.message || payload?.error_code || "";
  const rawMessage = `Request failed (${status} ${statusText}): ${errorText}`;
  return new UserFacingError(requestErrorMessage(status, detail), {
    code: detail || undefined,
    status,
    rawMessage,
  });
}

export function localizeSessionLastError(lastError: string | null | undefined, fallback = "任务处理中断，请重新扫描后再继续。"): string {
  const normalized = String(lastError || "").trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (normalized === "scanning_interrupted") {
    return "扫描过程中已中断，请重新扫描后再继续。";
  }
  if (normalized === "missing_execution_journal") {
    return "没有找到这次整理的执行记录。";
  }
  if (normalized === "directory_changed") {
    return "目录内容已变化，请重新扫描后再继续。";
  }
  if (
    normalized.includes("504")
    || normalized.includes("gateway timeout")
    || normalized.includes("gateway time-out")
    || normalized.includes("api timeout")
    || normalized.includes("apitimeouterror")
  ) {
    return "模型服务响应超时，扫描已经停止。建议稍后重试，或在设置中切换到更稳定的模型服务。";
  }
  if (normalized.includes("rate limit") || normalized.includes("429")) {
    return "模型服务请求过于频繁，扫描已经停止。请稍后重试。";
  }
  return fallback;
}

export function localizeUserFacingError(error: unknown, fallback: string): string {
  if (error instanceof UserFacingError) {
    return error.message || fallback;
  }
  if (error instanceof TypeError) {
    return "暂时无法连接本地服务，请确认 FilePilot 后台仍在运行。";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

export function getUserFacingErrorCode(error: unknown): string | null {
  if (error instanceof UserFacingError && error.code) {
    return error.code;
  }
  return null;
}

