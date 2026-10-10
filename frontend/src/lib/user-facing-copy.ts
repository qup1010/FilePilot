import i18n from "@/i18n/instance";

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

function parseErrorPayload(errorText: string): { detail?: string; error_code?: string; code?: string } | null {
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
      const errorCode = typeof parsed.error_code === "string" ? parsed.error_code : undefined;
      const code = typeof parsed.code === "string" ? parsed.code : undefined;
      return { detail, error_code: errorCode, code };
    }
  } catch {
    return { detail: trimmed };
  }
  return null;
}

const REQUEST_ERROR_COPY_KEYS: Record<string, string> = {
  SESSION_NOT_FOUND: "sessionNotFound",
  SESSION_STAGE_CONFLICT: "sessionStageConflict",
  SESSION_LOCKED: "sessionLocked",
  CONFIRMATION_REQUIRED: "confirmationRequired",
  OUTPUT_DIR_REQUIRED: "outputDirectoryRequired",
  NEW_DIRECTORY_ROOT_REQUIRED: "outputDirectoryRequired",
  REVIEW_ROOT_REQUIRED: "reviewDirectoryRequired",
  REVIEW_ROOT_CONFLICT: "reviewDirectoryConflict",
  TARGET_DIRECTORIES_REQUIRED: "targetDirectoriesRequired",
  TARGET_PROFILE_NOT_FOUND: "targetProfileNotFound",
  SOURCE_PATH_DRIVE_ROOT: "sourceDriveRoot",
  SOURCE_PATH_SYSTEM_PROTECTED: "sourceSystemProtected",
  SOURCE_PATH_PROJECT_ROOT: "sourceProjectRoot",
  SOURCE_PATH_EMPTY: "sourceRequired",
  INCREMENTAL_TARGET_NOT_ALLOWED: "incrementalTargetNotAllowed",
  ABSOLUTE_TARGET_DIR_NOT_ALLOWED: "absoluteTargetNotAllowed",
  TARGET_DIR_OUTSIDE_ROOT: "targetOutsideRoot",
  REVIEW_SUBDIRECTORY_NOT_ALLOWED: "reviewSubdirectoryNotAllowed",
  RULE_DRAFTS_THINKING_TOOL_UNSUPPORTED: "ruleDraftThinkingUnsupported",
  RULE_DRAFTS_TOOL_UNSUPPORTED: "ruleDraftToolUnsupported",
  RULE_DRAFTS_MODEL_AUTH: "ruleDraftModelAuth",
  RULE_DRAFTS_MODEL_RATE_LIMIT: "ruleDraftModelRateLimit",
  RULE_DRAFTS_MODEL_TIMEOUT: "ruleDraftModelTimeout",
  RULE_DRAFTS_MODEL_NETWORK: "ruleDraftModelNetwork",
  RULE_DRAFTS_MODEL_REJECTED: "ruleDraftModelRejected",
  RULE_DRAFTS_MODEL_ERROR: "ruleDraftModelError",
  RULE_DRAFTS_MISSING_TOOL_CALL: "ruleDraftMissingToolCall",
  RULE_DRAFTS_PATHS_NOT_IN_PROFILE: "ruleDraftPathsNotInProfile",
  UI_LANGUAGE_INVALID: "uiLanguageInvalid",
  HISTORY_ENTRY_NOT_FOUND: "historyEntryNotFound",
  ICON_SESSION_NOT_FOUND: "iconSessionNotFound",
  ICON_FOLDER_NOT_FOUND: "iconFolderNotFound",
  SETTINGS_FAMILY_INVALID: "settingsFamilyInvalid",
  SETTINGS_SECRET_ACTION_INVALID: "settingsSecretActionInvalid",
  SETTINGS_PRESET_TYPE_INVALID: "settingsPresetTypeInvalid",
  SETTINGS_PRESET_NOT_FOUND: "settingsPresetNotFound",
  UNAUTHORIZED: "unauthorized",
};

function requestErrorMessage(status: number, detail?: string): string {
  const normalizedDetail = String(detail || "").trim().toUpperCase();
  const copyKey = REQUEST_ERROR_COPY_KEYS[normalizedDetail];
  if (copyKey) {
    return i18n.t(`diagnostics.http.${copyKey}`);
  }
  if (normalizedDetail.startsWith("RULE_DRAFTS_INVALID_JSON")) {
    return i18n.t("diagnostics.http.ruleDraftInvalidJson");
  }

  if (status === 401 || status === 403) {
    return i18n.t("diagnostics.http.unauthorized");
  }
  if (status === 404) {
    return i18n.t("diagnostics.http.notFound");
  }
  if (status === 409) {
    return i18n.t("diagnostics.http.conflict");
  }
  if (status >= 500) {
    return i18n.t("diagnostics.http.serverError");
  }
  if (status >= 400) {
    return i18n.t("diagnostics.http.requestRejected");
  }
  return i18n.t("diagnostics.http.operationFailed");
}

export function createUserFacingRequestError(status: number, statusText: string, errorText: string): UserFacingError {
  const payload = parseErrorPayload(errorText);
  // Use machine-readable codes for copy; backend messages are retained only in rawMessage.
  const detailCode = payload?.detail && /^[A-Z][A-Z0-9_]*(?::[A-Z0-9_-]+)?$/.test(payload.detail.trim())
    ? payload.detail
    : "";
  const code = payload?.error_code || payload?.code || detailCode;
  const message = requestErrorMessage(status, code);
  const rawMessage = `Request failed (${status} ${statusText}): ${errorText}`;
  return new UserFacingError(message, {
    code: code || undefined,
    status,
    rawMessage,
  });
}

export function localizeSessionLastError(lastError: string | null | undefined, fallback?: string): string {
  const translatedFallback = fallback ?? i18n.t("workspace.fallback.interrupted");
  const normalized = String(lastError || "").trim().toLowerCase();
  if (!normalized) {
    return translatedFallback;
  }
  if (normalized === "scanning_interrupted") {
    return i18n.t("workspace.fallback.scanningInterrupted");
  }
  if (normalized === "missing_execution_journal") {
    return i18n.t("workspace.fallback.missingJournal");
  }
  if (normalized === "directory_changed") {
    return i18n.t("workspace.fallback.directoryChanged");
  }
  if (
    normalized.includes("504")
    || normalized.includes("gateway timeout")
    || normalized.includes("gateway time-out")
    || normalized.includes("api timeout")
    || normalized.includes("apitimeouterror")
  ) {
    return i18n.t("workspace.fallback.modelTimeout");
  }
  if (normalized.includes("rate limit") || normalized.includes("429")) {
    return i18n.t("workspace.fallback.modelRateLimit");
  }
  return translatedFallback;
}

export function localizeUserFacingError(error: unknown, fallback: string): string {
  if (error instanceof UserFacingError) {
    return error.message || fallback;
  }
  if (error instanceof TypeError) {
    return i18n.t("workspace.fallback.localServiceUnavailable");
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

