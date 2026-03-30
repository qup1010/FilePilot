export type SettingsFamily = "text" | "vision" | "icon_image";
export type SecretState = "empty" | "stored";
export type SecretAction = "keep" | "replace" | "clear";

export interface PresetSummary {
  id: string;
  name: string;
  secret_state?: SecretState;
}

export interface TextSettingsPreset extends PresetSummary {
  OPENAI_BASE_URL: string;
  OPENAI_MODEL: string;
  secret_state: SecretState;
}

export interface VisionSettingsPreset extends PresetSummary {
  IMAGE_ANALYSIS_NAME: string;
  IMAGE_ANALYSIS_BASE_URL: string;
  IMAGE_ANALYSIS_MODEL: string;
  secret_state: SecretState;
}

export interface SafeModelConfig {
  base_url: string;
  model: string;
  secret_state: SecretState;
  configured?: boolean;
  name?: string;
}

export interface IconImageSettingsPreset extends PresetSummary {
  image_model: SafeModelConfig;
  image_size: string;
  concurrency_limit: number;
  save_mode: "in_folder" | "centralized";
}

export interface SettingsSnapshot {
  global_config: Record<string, any>;
  families: {
    text: {
      family: "text";
      configured: boolean;
      active_preset_id: string;
      active_preset: TextSettingsPreset;
      presets: TextSettingsPreset[];
    };
    vision: {
      family: "vision";
      enabled: boolean;
      configured: boolean;
      active_preset_id: string;
      active_preset: VisionSettingsPreset;
      presets: VisionSettingsPreset[];
    };
    icon_image: {
      family: "icon_image";
      configured: boolean;
      active_preset_id: string;
      active_preset: IconImageSettingsPreset & {
        text_model: SafeModelConfig;
      };
      presets: IconImageSettingsPreset[];
    };
  };
  status: {
    text_configured: boolean;
    vision_configured: boolean;
    icon_image_configured: boolean;
  };
}

export interface SettingsSecretInput {
  action: SecretAction;
  value?: string;
}

export interface TextSettingsPresetPatch {
  name?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
}

export interface VisionSettingsPresetPatch {
  name?: string;
  IMAGE_ANALYSIS_NAME?: string;
  IMAGE_ANALYSIS_BASE_URL?: string;
  IMAGE_ANALYSIS_MODEL?: string;
}

export interface IconImageSettingsPresetPatch {
  name?: string;
  image_model?: Partial<SafeModelConfig>;
  image_size?: string;
  concurrency_limit?: number;
  save_mode?: "in_folder" | "centralized";
}

export interface SettingsUpdatePayload {
  global_config?: Record<string, any>;
  families?: Partial<{
    text: {
      preset?: TextSettingsPresetPatch;
      secret?: SettingsSecretInput;
    };
    vision: {
      enabled?: boolean;
      preset?: VisionSettingsPresetPatch;
      secret?: SettingsSecretInput;
    };
    icon_image: {
      preset?: IconImageSettingsPresetPatch;
      secret?: SettingsSecretInput;
    };
  }>;
}

export interface SettingsPresetCreatePayload {
  name: string;
  copy_from_active?: boolean;
  preset?: Record<string, any>;
  secret?: SettingsSecretInput;
}

export interface SettingsTestResult {
  status: "ok" | "error";
  family: SettingsFamily;
  code: string;
  message: string;
}
