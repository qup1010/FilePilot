import { describe, expect, it } from "vitest";

import { buildFamilySavePayload, isEditablePreset } from "./preset-flow";

describe("isEditablePreset", () => {
  it("returns false for default preset", () => {
    expect(isEditablePreset("default")).toBe(false);
  });

  it("returns true for user preset id", () => {
    expect(isEditablePreset("preset-user-1")).toBe(true);
  });
});

describe("buildFamilySavePayload", () => {
  it("builds text payload without preset name", () => {
    expect(
      buildFamilySavePayload("text", {
        OPENAI_BASE_URL: "https://api.openai.com/v1",
        OPENAI_MODEL: "gpt-5.4",
      }),
    ).toEqual({
      preset: {
        OPENAI_BASE_URL: "https://api.openai.com/v1",
        OPENAI_MODEL: "gpt-5.4",
      },
    });
  });

  it("builds vision payload without preset name", () => {
    expect(
      buildFamilySavePayload("vision", {
        IMAGE_ANALYSIS_NAME: "vision-a",
        IMAGE_ANALYSIS_BASE_URL: "https://host.example/v1",
        IMAGE_ANALYSIS_MODEL: "gpt-4o-mini",
      }),
    ).toEqual({
      preset: {
        IMAGE_ANALYSIS_NAME: "vision-a",
        IMAGE_ANALYSIS_BASE_URL: "https://host.example/v1",
        IMAGE_ANALYSIS_MODEL: "gpt-4o-mini",
      },
    });
  });

  it("builds icon image payload without preset name", () => {
    expect(
      buildFamilySavePayload("icon_image", {
        image_model: { base_url: "https://host.example/v1", model: "gpt-image-1" },
        image_size: "1024x1024",
        analysis_concurrency_limit: 1,
        image_concurrency_limit: 1,
        save_mode: "in_folder",
      }),
    ).toEqual({
      preset: {
        image_model: { base_url: "https://host.example/v1", model: "gpt-image-1" },
        image_size: "1024x1024",
        analysis_concurrency_limit: 1,
        image_concurrency_limit: 1,
        save_mode: "in_folder",
      },
    });
  });
});
