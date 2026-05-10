import type { LaunchStrategyConfig } from "@/types/session";

export type SettingsFamily = "text" | "vision" | "icon_image" | "bg_removal";
export type SecretState = "empty" | "stored";
export type SecretAction = "keep" | "replace" | "clear";
export type VisionSourceMode = "shared_text" | "separate";

export type SettingsGlobalConfig = Record<string, any> & LaunchStrategyConfig;

export interface PresetSummary {
  id: string;
  name: string;
  secret_state?: SecretState;
}

export interface ProviderCapabilities {
  chat?: boolean;
  streaming?: boolean;
  tools?: boolean;
  vision?: boolean;
  json_output?: boolean;
  image_generation?: boolean;
}

export interface ProviderMetadata {
  provider?: string;
  api_format?: string;
  tool_mode?: string;
  capabilities?: ProviderCapabilities;
}

export interface TextSettingsPreset extends PresetSummary, ProviderMetadata {
  OPENAI_BASE_URL: string;
  OPENAI_MODEL: string;
  OPENAI_API_KEY: string;
  secret_state: SecretState;
}

export interface VisionSettingsPreset extends PresetSummary, ProviderMetadata {
  IMAGE_ANALYSIS_NAME: string;
  IMAGE_ANALYSIS_BASE_URL: string;
  IMAGE_ANALYSIS_MODEL: string;
  IMAGE_ANALYSIS_API_KEY: string;
  secret_state: SecretState;
}

export interface SafeModelConfig extends ProviderMetadata {
  base_url: string;
  model: string;
  api_key?: string;
  secret_state: SecretState;
  configured?: boolean;
  name?: string;
}

export interface IconImageSettingsPreset extends PresetSummary {
  image_model: SafeModelConfig;
  image_size: string;
  analysis_concurrency_limit: number;
  image_concurrency_limit: number;
  save_mode: "in_folder" | "centralized";
}

export interface BgRemovalBuiltinPreset {
  id: string;
  name: string;
  model_id: string;
  api_type: string;
  payload_template: string;
}

export interface BgRemovalSettingsPreset {
  name: string;
  model_id: string;
  api_type: string;
  payload_template: string;
  hf_api_token: string;
  secret_state: SecretState;
}

export interface BgRemovalDraft {
  mode: "preset" | "custom";
  preset_id: string | null;
  custom: BgRemovalSettingsPreset;
}

export interface SettingsSnapshot {
  global_config: SettingsGlobalConfig;
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
      mode: VisionSourceMode;
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
    bg_removal: {
      family: "bg_removal";
      configured: boolean;
      mode: "preset" | "custom";
      preset_id: string | null;
      active_preset: BgRemovalSettingsPreset;
      builtin_presets: BgRemovalBuiltinPreset[];
      custom: BgRemovalSettingsPreset;
    };
  };
  status: {
    text_configured: boolean;
    vision_configured: boolean;
    icon_image_configured: boolean;
    bg_removal_configured: boolean;
  };
  runtime: {
    log_paths: {
      runtime_log: string;
      debug_log: string;
    };
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
  analysis_concurrency_limit?: number;
  image_concurrency_limit?: number;
  save_mode?: "in_folder" | "centralized";
}

export interface BgRemovalSettingsPatch {
  mode?: "preset" | "custom";
  preset?: {
    preset_id?: string;
  };
  custom?: {
    name?: string;
    model_id?: string;
    api_type?: string;
    payload_template?: string;
  };
  secret?: SettingsSecretInput;
}

export interface SettingsUpdatePayload {
  global_config?: SettingsGlobalConfig;
  families?: Partial<{
    text: {
      preset?: TextSettingsPresetPatch;
      secret?: SettingsSecretInput;
    };
    vision: {
      enabled?: boolean;
      mode?: VisionSourceMode;
      preset?: VisionSettingsPresetPatch;
      secret?: SettingsSecretInput;
    };
    icon_image: {
      preset?: IconImageSettingsPresetPatch;
      secret?: SettingsSecretInput;
    };
    bg_removal: BgRemovalSettingsPatch;
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
  details?: {
    verification_type: "vision_text";
    expected: string;
    actual?: string;
  };
}
