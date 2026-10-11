import type {
  SecretAction,
  SecretState,
  SettingsFamily,
  SettingsModelListResult,
  SettingsSnapshot,
  TextSettingsPreset,
  VisionSourceMode,
  VisionSettingsPreset,
} from "@/types/settings";
import type { TargetProfileDirectory } from "@/types/session";

export type SecretDraft = {
  action: SecretAction;
  value: string;
  visible: boolean;
};

export type PresetConfigFamily = Exclude<SettingsFamily, "bg_removal">;

export type DraftState = {
  global_config: SettingsSnapshot["global_config"];
  text: TextSettingsPreset;
  vision: VisionSettingsPreset;
  icon_image: SettingsSnapshot["families"]["icon_image"]["active_preset"];
  bg_removal: {
    mode: SettingsSnapshot["families"]["bg_removal"]["mode"];
    preset_id: SettingsSnapshot["families"]["bg_removal"]["preset_id"];
    custom: SettingsSnapshot["families"]["bg_removal"]["custom"];
  };
};

export type ModelLookupState = Partial<Record<PresetConfigFamily, SettingsModelListResult>>;

export type TargetProfileDraft = {
  name: string;
  directories: TargetProfileDirectory[];
  newPath: string;
  newLabel: string;
  newDescription: string;
};

export const SETTINGS_TAB_IDS = ["text", "icon_image", "bg_removal", "launch", "system"] as const;

export const IMAGE_SIZE_OPTIONS = ["1024x1024", "512x512", "256x256"] as const;

export function targetDirectoryEditorKey(profileId: string, path: string): string {
  return `${profileId}::${path.trim().toLowerCase()}`;
}

export function normalizeImageSize(value: string | null | undefined): (typeof IMAGE_SIZE_OPTIONS)[number] {
  if (value && IMAGE_SIZE_OPTIONS.includes(value as (typeof IMAGE_SIZE_OPTIONS)[number])) {
    return value as (typeof IMAGE_SIZE_OPTIONS)[number];
  }
  return "1024x1024";
}

export function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createSecretDraft(initialValue: string = "", isStored?: boolean): SecretDraft {
  const hasValue = Boolean(initialValue.trim());
  const stored = hasValue || isStored;
  return {
    action: "keep",
    value: hasValue ? initialValue : (stored ? "********" : ""),
    visible: false,
  };
}

export function clampConcurrencyInput(value: string, fallback: number): number {
  const trimmed = value.trim();
  if (!trimmed) {
    return Math.max(1, Math.min(6, fallback || 1));
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return Math.max(1, Math.min(6, fallback || 1));
  }
  return Math.max(1, Math.min(6, Math.trunc(parsed) || 1));
}

export function snapshotToDraft(snapshot: SettingsSnapshot): DraftState {
  const iconImagePreset = cloneValue(snapshot.families.icon_image.active_preset);
  return {
    global_config: cloneValue(snapshot.global_config),
    text: cloneValue(snapshot.families.text.active_preset),
    vision: cloneValue(snapshot.families.vision.active_preset),
    icon_image: {
      ...iconImagePreset,
      image_size: normalizeImageSize(iconImagePreset.image_size),
    },
    bg_removal: {
      mode: snapshot.families.bg_removal.mode,
      preset_id: snapshot.families.bg_removal.preset_id,
      custom: cloneValue(snapshot.families.bg_removal.custom),
    },
  };
}

export function buildSecretPayload(secret: SecretDraft) {
  if (secret.action === "replace" && secret.value.trim()) {
    return { action: "replace" as const, value: secret.value.trim() };
  }
  if (secret.action === "clear") {
    return { action: "clear" as const };
  }
  return { action: "keep" as const };
}

export function describeSecret(secretState: SecretState, secret: SecretDraft) {
  if (secret.action === "replace" && secret.value.trim()) {
    return "settingsPage.formFields.secret.entered";
  }
  if (secret.action === "clear") {
    return "settingsPage.formFields.secret.removed";
  }
  return secretState === "stored"
    ? "settingsPage.formFields.secret.stored"
    : "settingsPage.formFields.secret.empty";
}

export const LAUNCH_GLOBAL_KEYS = [
  "LAUNCH_DEFAULT_TEMPLATE_ID",
  "LAUNCH_DEFAULT_ORGANIZE_METHOD",
  "LAUNCH_DEFAULT_LANGUAGE",
  "LAUNCH_DEFAULT_DENSITY",
  "LAUNCH_DEFAULT_PREFIX_STYLE",
  "LAUNCH_DEFAULT_CAUTION_LEVEL",
  "LAUNCH_DEFAULT_NOTE",
  "LAUNCH_DEFAULT_NEW_DIRECTORY_ROOT",
  "LAUNCH_DEFAULT_REVIEW_ROOT",
  "LAUNCH_REVIEW_FOLLOWS_NEW_ROOT",
  "LAUNCH_SKIP_STRATEGY_PROMPT",
  "LAUNCH_DEFAULT_TARGET_PROFILE_ID",
] as const;

export function pickGlobalConfig(source: SettingsSnapshot["global_config"], keys: readonly string[]) {
  return keys.reduce<Record<string, unknown>>((result, key) => {
    result[key] = source[key];
    return result;
  }, {});
}

export function buildSettingsTabFingerprint(
  tabId: string,
  draft: DraftState | null,
  secrets: Record<SettingsFamily, SecretDraft>,
  transientInputs: {
    analysisConcurrencyInput: string;
    imageConcurrencyInput: string;
  },
) {
  if (!draft) {
    return "";
  }

  if (tabId === "text") {
    return JSON.stringify({
      text: draft.text,
      visionEnabled: Boolean(draft.global_config.IMAGE_ANALYSIS_ENABLED),
      visionMode: getVisionSourceMode(draft.global_config),
      vision: draft.vision,
      secret: { action: secrets.text.action, value: secrets.text.action === "keep" ? "" : secrets.text.value },
      visionSecret: { action: secrets.vision.action, value: secrets.vision.action === "keep" ? "" : secrets.vision.value },
    });
  }
  if (tabId === "icon_image") {
    return JSON.stringify({
      icon_image: draft.icon_image,
      analysisConcurrencyInput: transientInputs.analysisConcurrencyInput,
      imageConcurrencyInput: transientInputs.imageConcurrencyInput,
      secret: { action: secrets.icon_image.action, value: secrets.icon_image.action === "keep" ? "" : secrets.icon_image.value },
    });
  }
  if (tabId === "bg_removal") {
    return JSON.stringify({
      bg_removal: draft.bg_removal,
      secret: { action: secrets.bg_removal.action, value: secrets.bg_removal.action === "keep" ? "" : secrets.bg_removal.value },
    });
  }
  if (tabId === "launch") {
    return JSON.stringify(pickGlobalConfig(draft.global_config, LAUNCH_GLOBAL_KEYS));
  }
  if (tabId === "system") {
    return JSON.stringify({
      DEBUG_MODE: Boolean(draft.global_config.DEBUG_MODE),
      UI_LANGUAGE: draft.global_config.UI_LANGUAGE ?? "system",
    });
  }
  return "";
}

export function createSecretDraftsFromSnapshot(snapshot: SettingsSnapshot): Record<SettingsFamily, SecretDraft> {
  return {
    text: createSecretDraft(
      snapshot.families.text.active_preset.OPENAI_API_KEY || "",
      snapshot.families.text.active_preset.secret_state === "stored"
    ),
    vision: createSecretDraft(
      snapshot.families.vision.active_preset.IMAGE_ANALYSIS_API_KEY || "",
      snapshot.families.vision.active_preset.secret_state === "stored"
    ),
    icon_image: createSecretDraft(
      snapshot.families.icon_image.active_preset.image_model.api_key || "",
      snapshot.families.icon_image.active_preset.image_model.secret_state === "stored"
    ),
    bg_removal: createSecretDraft(
      snapshot.families.bg_removal.active_preset.hf_api_token || "",
      snapshot.families.bg_removal.active_preset.secret_state === "stored"
    ),
  };
}

export function getVisionSourceMode(globalConfig: SettingsSnapshot["global_config"] | null | undefined): VisionSourceMode {
  return globalConfig?.IMAGE_ANALYSIS_SOURCE_MODE === "separate" ? "separate" : "shared_text";
}

export function buildFingerprint(
  draft: DraftState | null,
  secrets: Record<SettingsFamily, SecretDraft>,
  transientInputs?: {
    analysisConcurrencyInput: string;
    imageConcurrencyInput: string;
  },
) {
  if (!draft) {
    return "";
  }
  return JSON.stringify({
    draft,
    transientInputs: transientInputs ?? null,
    secrets: {
      text: { action: secrets.text.action, value: secrets.text.action === "keep" ? "" : secrets.text.value },
      vision: { action: secrets.vision.action, value: secrets.vision.action === "keep" ? "" : secrets.vision.value },
      icon_image: { action: secrets.icon_image.action, value: secrets.icon_image.action === "keep" ? "" : secrets.icon_image.value },
      bg_removal: { action: secrets.bg_removal.action, value: secrets.bg_removal.action === "keep" ? "" : secrets.bg_removal.value },
    },
  });
}

export function copyTextToClipboard(
  value: string,
  onSuccess: (message: string) => void,
  onError: (message: string) => void,
  messages: { unsupported: string; copied: string; failed: string },
) {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    onError(messages.unsupported);
    return;
  }
  void navigator.clipboard.writeText(value).then(
    () => onSuccess(messages.copied),
    () => onError(messages.failed),
  );
}

export function buildTargetProfilesFingerprint(drafts: Record<string, TargetProfileDraft>): string {
  return JSON.stringify(
    Object.entries(drafts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([profileId, draft]) => ({
        profile_id: profileId,
        name: draft.name.trim(),
        directories: draft.directories
          .map((item) => ({
            path: item.path.trim(),
            label: item.label?.trim() || "",
            description: item.description?.trim() || "",
          }))
          .filter((item) => item.path)
          .sort((left, right) => left.path.localeCompare(right.path)),
      })),
  );
}
