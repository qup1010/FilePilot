import type { TFunction } from "i18next";

import type { SettingsTestResult } from "@/types/settings";

type DiagnosticTranslator = TFunction<"common">;

const SETTINGS_TEST_ERROR_KEYS: Record<string, string> = {
  "401": "unauthorized",
  "403": "forbidden",
  "404": "notFound",
  capability_mismatch: "capabilityMismatch",
  "429": "rateLimited",
  network_blocked: "networkBlocked",
  timeout: "timeout",
  network: "network",
  vision_image_format_rejected: "visionImageFormatRejected",
  model_not_found: "modelNotFound",
  vision_not_verified: "visionNotVerified",
  invalid_family: "invalidFamily",
  settings_secret_action_invalid: "invalidSecretAction",
  unknown: "unknown",
  desktop_unavailable: "desktopUnavailable",
};

const SETTINGS_TEST_ISSUE_KEYS: Record<string, string> = {
  network_blocked: "networkBlocked",
  vision_image_format_rejected: "visionImageFormatRejected",
  timeout: "timeout",
  "401": "unauthorized",
  "403": "unauthorized",
  "404": "modelNotFound",
  model_not_found: "modelNotFound",
  network: "network",
};

export function getSettingsTestMessage(result: SettingsTestResult, t: DiagnosticTranslator): string {
  if (result.status === "ok") {
    return t(`diagnostics.settingsTests.success.${result.family}`);
  }

  if (result.code === "incomplete_config") {
    const familyKey = result.family === "text"
      ? "incompleteTextConfig"
      : result.family === "vision"
        ? "incompleteVisionConfig"
        : "incompleteIconConfig";
    return t(`diagnostics.settingsTests.errors.${familyKey}`);
  }

  if (result.code === "request_failed") {
    // This code is assigned only in the client catch path, where message has
    // already passed through localizeUserFacingError.
    return result.message || t("diagnostics.settingsTests.errors.requestFailed");
  }

  const key = SETTINGS_TEST_ERROR_KEYS[result.code] ?? "unknown";
  return t(`diagnostics.settingsTests.errors.${key}`);
}

export function getSettingsTestIssueHint(result: SettingsTestResult, t: DiagnosticTranslator): string {
  const key = SETTINGS_TEST_ISSUE_KEYS[result.code] ?? "default";
  return t(`diagnostics.settingsTests.issues.${key}`);
}
