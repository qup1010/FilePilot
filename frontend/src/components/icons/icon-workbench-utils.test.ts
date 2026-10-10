import { describe, expect, it } from "vitest";

import i18n from "@/i18n/instance";
import type { IconTemplate, IconWorkbenchHistoryItem } from "@/types/icon-workbench";
import {
  getGenerateFlowPresentation,
  getIconWorkbenchHistoryActionMessage,
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

  it("rebuilds legacy history action summaries in the selected language", () => {
    const item: IconWorkbenchHistoryItem = {
      session_id: "legacy-session",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      target_count: 1,
      folder_count: 1,
      ready_count: 1,
      applied_count: 1,
      error_count: 0,
      target_paths: ["D:/Icons/Alpha"],
      last_action_type: "apply_icons",
      last_action_message: "应用图标已完成：成功 1，失败 0，跳过 0。",
      last_action_success_count: 1,
      last_action_failed_count: 0,
      last_action_skipped_count: 0,
    };

    expect(getIconWorkbenchHistoryActionMessage(item, i18n.getFixedT("en", "common"), "en"))
      .toBe("Batch apply finished: 1 succeeded, 0 failed, 0 skipped.");
    expect(getIconWorkbenchHistoryActionMessage(item, i18n.getFixedT("zh-CN", "common"), "zh-CN"))
      .toBe("应用图标已完成：成功 1，失败 0，跳过 0。");
    expect(getIconWorkbenchHistoryActionMessage({
      ...item,
      last_action_success_count: null,
      last_action_failed_count: null,
      last_action_skipped_count: null,
    }, i18n.getFixedT("en", "common"), "en"))
      .toBe("Batch apply finished.");
  });

  it("does not expose an unknown legacy Chinese action message in English", () => {
    const item: IconWorkbenchHistoryItem = {
      session_id: "legacy-session",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      target_count: 1,
      folder_count: 1,
      ready_count: 1,
      applied_count: 0,
      error_count: 0,
      target_paths: [],
      last_action_type: "legacy_action",
      last_action_message: "旧版中文操作摘要",
    };

    expect(getIconWorkbenchHistoryActionMessage(item, i18n.getFixedT("en", "common"), "en"))
      .toBe("A previous action was completed.");
    expect(getIconWorkbenchHistoryActionMessage(item, i18n.getFixedT("zh-CN", "common"), "zh-CN"))
      .toBe("旧版中文操作摘要");
  });
});
