import { describe, expect, it } from "vitest";

import i18n from "@/i18n/instance";
import type { IconTemplate } from "@/types/icon-workbench";
import {
  getGenerateFlowPresentation,
  getIconTemplateDisplayDescription,
  getIconTemplateDisplayName,
} from "./icon-workbench-utils";

const builtinTemplate: IconTemplate = {
  template_id: "3d_clay",
  name: "3D 黏土",
  description: "中文内置风格描述",
  prompt_template: "{{subject}}, clay style",
  is_builtin: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("icon workbench localization helpers", () => {
  it("localizes built-in style labels by stable template ID and preserves custom content", () => {
    const t = i18n.getFixedT("en", "common");
    const customTemplate = {
      ...builtinTemplate,
      template_id: "custom-template",
      name: "用户自定义名称",
      description: "用户编写的自定义描述",
      is_builtin: false,
    };

    expect(getIconTemplateDisplayName(builtinTemplate, t)).toBe("3D Clay");
    expect(getIconTemplateDisplayDescription(builtinTemplate, t)).toContain("Soft pastel colors");
    expect(getIconTemplateDisplayName(customTemplate, t)).toBe("用户自定义名称");
    expect(getIconTemplateDisplayDescription(customTemplate, t)).toBe("用户编写的自定义描述");
    expect(getIconTemplateDisplayDescription({ ...customTemplate, description: "" }, t))
      .toBe(t("iconWorkbench.stylePicker.fallbackDescription"));
  });

  it("uses English progress copy and plural forms", () => {
    const t = i18n.getFixedT("en", "common");
    const presentation = getGenerateFlowPresentation({
      stage: "analyzing",
      totalFolders: 2,
      completedFolders: 0,
      currentFolderId: null,
      currentFolderName: null,
      steps: ["analyzing", "applying_template", "generating"],
    }, t);

    expect(presentation.title).toBe("Analyzing 2 target folders");
    expect(presentation.detail).toBe("Reading folder structure and identifying an icon theme for each folder.");
    expect(presentation.steps.map((step) => step.label)).toEqual([
      "Analyze folders",
      "Apply style",
      "Generate previews",
    ]);
  });
});
