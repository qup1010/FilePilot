import type { IconImageSettingsPresetPatch, TextSettingsPresetPatch, VisionSettingsPresetPatch } from "@/types/settings";

type PresetConfigFamily = "text" | "vision" | "icon_image";

type FamilyFields = {
  text: Required<Pick<TextSettingsPresetPatch, "OPENAI_BASE_URL" | "OPENAI_MODEL">>;
  vision: Required<Pick<VisionSettingsPresetPatch, "IMAGE_ANALYSIS_NAME" | "IMAGE_ANALYSIS_BASE_URL" | "IMAGE_ANALYSIS_MODEL">>;
  icon_image: Required<
    Pick<IconImageSettingsPresetPatch, "image_model" | "image_size" | "analysis_concurrency_limit" | "image_concurrency_limit" | "save_mode">
  >;
};

export function isEditablePreset(presetId: string | null | undefined): boolean {
  return Boolean(presetId && presetId !== "default");
}

export function buildFamilySavePayload(family: "text", fields: FamilyFields["text"]): { preset: FamilyFields["text"] };
export function buildFamilySavePayload(family: "vision", fields: FamilyFields["vision"]): { preset: FamilyFields["vision"] };
export function buildFamilySavePayload(family: "icon_image", fields: FamilyFields["icon_image"]): { preset: FamilyFields["icon_image"] };
export function buildFamilySavePayload(family: PresetConfigFamily, fields: FamilyFields[PresetConfigFamily]) {
  if (family === "text") {
    const textFields = fields as FamilyFields["text"];
    return {
      preset: {
        OPENAI_BASE_URL: textFields.OPENAI_BASE_URL,
        OPENAI_MODEL: textFields.OPENAI_MODEL,
      },
    };
  }

  if (family === "vision") {
    const visionFields = fields as FamilyFields["vision"];
    return {
      preset: {
        IMAGE_ANALYSIS_NAME: visionFields.IMAGE_ANALYSIS_NAME,
        IMAGE_ANALYSIS_BASE_URL: visionFields.IMAGE_ANALYSIS_BASE_URL,
        IMAGE_ANALYSIS_MODEL: visionFields.IMAGE_ANALYSIS_MODEL,
      },
    };
  }

  const iconImageFields = fields as FamilyFields["icon_image"];
  return {
    preset: {
      image_model: iconImageFields.image_model,
      image_size: iconImageFields.image_size,
      analysis_concurrency_limit: iconImageFields.analysis_concurrency_limit,
      image_concurrency_limit: iconImageFields.image_concurrency_limit,
      save_mode: iconImageFields.save_mode,
    },
  };
}
