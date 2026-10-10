import type { TFunction } from "i18next";

import type { FolderIconCandidate, IconPreviewVersion, IconTemplate, IconWorkbenchHistoryItem } from "@/types/icon-workbench";

export type GenerateFlowStage = "analyzing" | "applying_template" | "generating";
export interface GenerateFlowStepItem {
  key: GenerateFlowStage;
  label: string;
}

const GENERATE_STEP_KEYS: Record<GenerateFlowStage, string> = {
  analyzing: "iconWorkbench.progress.steps.analyzing",
  applying_template: "iconWorkbench.progress.steps.applying_template",
  generating: "iconWorkbench.progress.steps.generating",
};

export interface GenerateFlowProgress {
  stage: GenerateFlowStage;
  totalFolders: number;
  completedFolders: number;
  currentFolderId: string | null;
  currentFolderName: string | null;
  steps?: GenerateFlowStage[];
}

export interface GenerateFlowPresentation {
  title: string;
  detail: string;
  percent: number;
  counter: string;
  steps: GenerateFlowStepItem[];
}

export function getIconTemplateDisplayName(template: IconTemplate | null | undefined, t: TFunction<"common">): string {
  if (!template) return "";
  if (!template.is_builtin) return template.name;
  return t(`iconWorkbench.builtinStyles.${template.template_id}.name`, { defaultValue: template.name });
}

export function getIconTemplateDisplayDescription(template: IconTemplate, t: TFunction<"common">): string {
  if (!template.is_builtin) return template.description || t("iconWorkbench.stylePicker.fallbackDescription");
  return t(`iconWorkbench.builtinStyles.${template.template_id}.description`, {
    defaultValue: template.description || t("iconWorkbench.stylePicker.fallbackDescription"),
  });
}

export function getIconWorkbenchHistoryActionMessage(
  item: IconWorkbenchHistoryItem,
  t: TFunction<"common">,
  locale: string,
): string {
  const actionType = String(item.last_action_type || "").trim().toLowerCase();
  const summaryKeys: Record<string, { summary: string; generic: string }> = {
    apply_icons: {
      summary: "iconWorkbench.notices.batchAppliedSummary",
      generic: "iconWorkbench.notices.batchApplied",
    },
    restore_icons: {
      summary: "iconWorkbench.notices.batchRestoredSummary",
      generic: "iconWorkbench.notices.batchRestored",
    },
  };
  const actionCopy = summaryKeys[actionType];
  if (actionCopy) {
    const counts = [
      item.last_action_success_count,
      item.last_action_failed_count,
      item.last_action_skipped_count,
    ];
    if (counts.every((count) => typeof count === "number" && Number.isFinite(count))) {
      return t(actionCopy.summary, {
        success: counts[0],
        failed: counts[1],
        skipped: counts[2],
      });
    }
    return t(actionCopy.generic);
  }

  if (!item.last_action_type && !item.last_action_message) return "";
  if (/^zh(?:-|$)/i.test(locale) && item.last_action_message) return item.last_action_message;
  return t("iconWorkbench.history.actionCompleted");
}

/**
 * 构建大图或缩略图的完整 URL，支持带上鉴权 Token
 */
export function buildImageSrc(version: IconPreviewVersion, baseUrl: string, apiToken: string) {
  const url = new URL(version.image_url.replace(/^\//, ""), `${baseUrl.replace(/\/$/, "")}/`);
  if (apiToken) {
    url.searchParams.set("access_token", apiToken);
  }
  return url.toString();
}

/**
 * 检查文件夹是否已经有就绪的当前版本
 */
export function isFolderReady(folder: FolderIconCandidate) {
  if (!folder.current_version_id) {
    return false;
  }
  return folder.versions.some((version) => version.version_id === folder.current_version_id && version.status === "ready");
}

export function getCurrentVersion(folder: FolderIconCandidate): IconPreviewVersion | null {
  if (!folder.current_version_id) {
    return null;
  }
  return folder.versions.find((version) => version.version_id === folder.current_version_id) || null;
}

export function hasReadyVersion(folder: FolderIconCandidate) {
  return folder.versions.some((version) => version.status === "ready");
}

/**
 * 解析出默认的预览版本（优先用当前选中的，没有则用最新的 ready 版本）
 */
export function resolvePreviewVersion(folder: FolderIconCandidate): IconPreviewVersion | null {
  if (folder.current_version_id) {
    const current = folder.versions.find((version) => version.version_id === folder.current_version_id);
    if (current?.status === "ready") {
      return current;
    }
  }
  return [...folder.versions]
    .filter((version) => version.status === "ready")
    .sort((a, b) => b.version_number - a.version_number)[0] || null;
}

export function buildGenerateFlowSteps(needsAnalyze: boolean): GenerateFlowStage[] {
  return needsAnalyze
    ? ["analyzing", "applying_template", "generating"]
    : ["applying_template", "generating"];
}

export function getGenerateFlowPresentation(progress: GenerateFlowProgress, t: TFunction<"common">): GenerateFlowPresentation {
  const totalFolders = Math.max(progress.totalFolders, 1);
  const steps = (progress.steps?.length ? progress.steps : [progress.stage]).map((stage) => ({
    key: stage,
    label: t(GENERATE_STEP_KEYS[stage]),
  }));
  const stepKeys = steps.map((step) => step.key);
  const currentStepIndex = Math.max(stepKeys.indexOf(progress.stage), 0);

  if (progress.stage === "analyzing") {
    return {
      title: t("iconWorkbench.progress.analyzingTitle", { count: progress.totalFolders }),
      detail: t("iconWorkbench.progress.analyzingDetail"),
      percent: Math.max(12, Math.round(((currentStepIndex + 0.35) / Math.max(stepKeys.length, 1)) * 100)),
      counter: `${progress.completedFolders} / ${progress.totalFolders}`,
      steps,
    };
  }

  if (progress.stage === "applying_template") {
    const skipsAnalyze = !stepKeys.includes("analyzing");
    return {
      title: t(skipsAnalyze ? "iconWorkbench.progress.applyingTitleReusing" : "iconWorkbench.progress.applyingTitle"),
      detail: t(skipsAnalyze ? "iconWorkbench.progress.applyingDetailReusing" : "iconWorkbench.progress.applyingDetail"),
      percent: Math.max(28, Math.round(((currentStepIndex + 0.5) / Math.max(stepKeys.length, 1)) * 100)),
      counter: t("iconWorkbench.progress.targetCount", { count: progress.totalFolders }),
      steps,
    };
  }

  const completedFolders = Math.max(0, Math.min(progress.completedFolders, progress.totalFolders));
  const nextIndex = Math.min(progress.totalFolders, completedFolders + 1);
  const finished = completedFolders >= progress.totalFolders;
  const reusingAnalysis = !stepKeys.includes("analyzing");
  const stepProgress = totalFolders === 0 ? 1 : completedFolders / totalFolders;
  const percent = Math.max(
    reusingAnalysis ? 36 : 48,
    Math.round(((currentStepIndex + stepProgress) / Math.max(stepKeys.length, 1)) * 100),
  );

  return {
    title: finished
      ? t("iconWorkbench.progress.completedTitle")
      : t(reusingAnalysis ? "iconWorkbench.progress.regeneratingTitle" : "iconWorkbench.progress.generatingTitle", {
          index: nextIndex,
          total: progress.totalFolders,
        }),
    detail: finished
      ? t("iconWorkbench.progress.completedDetail", { count: progress.totalFolders })
      : progress.currentFolderName
        ? t("iconWorkbench.progress.currentTarget", { folderName: progress.currentFolderName })
        : reusingAnalysis
          ? t("iconWorkbench.progress.reusedProgress", { completed: completedFolders, total: progress.totalFolders })
          : t("iconWorkbench.progress.folderProgress", { completed: completedFolders, total: progress.totalFolders }),
    percent,
    counter: `${completedFolders} / ${progress.totalFolders}`,
    steps,
  };
}
