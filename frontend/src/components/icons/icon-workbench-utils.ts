import type { FolderIconCandidate, IconPreviewVersion, IconWorkbenchSession } from "@/types/icon-workbench";

export type GenerateFlowStage = "analyzing" | "applying_template" | "generating";
export interface GenerateFlowStepItem {
  key: GenerateFlowStage;
  label: string;
}

const GENERATE_STEP_LABELS: Record<GenerateFlowStage, string> = {
  analyzing: "分析目录",
  applying_template: "套用风格",
  generating: "生成预览",
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

export function getGenerateFlowPresentation(progress: GenerateFlowProgress): GenerateFlowPresentation {
  const totalFolders = Math.max(progress.totalFolders, 1);
  const steps = (progress.steps?.length ? progress.steps : [progress.stage]).map((stage) => ({
    key: stage,
    label: GENERATE_STEP_LABELS[stage],
  }));
  const stepKeys = steps.map((step) => step.key);
  const currentStepIndex = Math.max(stepKeys.indexOf(progress.stage), 0);

  if (progress.stage === "analyzing") {
    return {
      title: `正在分析 ${progress.totalFolders} 个目标文件夹`,
      detail: "先读取目录结构，整理每个文件夹的图标主题。",
      percent: Math.max(12, Math.round(((currentStepIndex + 0.35) / Math.max(stepKeys.length, 1)) * 100)),
      counter: `${progress.completedFolders} / ${progress.totalFolders}`,
      steps,
    };
  }

  if (progress.stage === "applying_template") {
    const skipsAnalyze = !stepKeys.includes("analyzing");
    return {
      title: skipsAnalyze ? "正在更新当前风格并准备生成" : "正在套用当前风格模板",
      detail: skipsAnalyze ? "已复用目录分析结果，只更新本轮风格与提示词。" : "把你选择的风格写入每个目标的生成提示词。",
      percent: Math.max(28, Math.round(((currentStepIndex + 0.5) / Math.max(stepKeys.length, 1)) * 100)),
      counter: `${progress.totalFolders} 个目标`,
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
      ? "图标预览已全部生成"
      : reusingAnalysis
        ? `正在重新生成第 ${nextIndex} / ${progress.totalFolders} 个图标`
        : `正在生成第 ${nextIndex} / ${progress.totalFolders} 个图标`,
    detail: finished
      ? `${progress.totalFolders} 个目标文件夹都已经完成本轮预览生成。`
      : progress.currentFolderName
        ? `当前目标：${progress.currentFolderName}`
        : reusingAnalysis
          ? `已复用目录分析结果，已完成 ${completedFolders} / ${progress.totalFolders}。`
          : `已完成 ${completedFolders} / ${progress.totalFolders} 个目标文件夹。`,
    percent,
    counter: `${completedFolders} / ${progress.totalFolders}`,
    steps,
  };
}
