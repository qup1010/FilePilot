import type { FolderIconCandidate, IconPreviewVersion, IconWorkbenchSession } from "@/types/icon-workbench";

export type GenerateFlowStage = "analyzing" | "applying_template" | "generating";

export interface GenerateFlowProgress {
  stage: GenerateFlowStage;
  totalFolders: number;
  completedFolders: number;
  currentFolderId: string | null;
  currentFolderName: string | null;
}

export interface GenerateFlowPresentation {
  title: string;
  detail: string;
  percent: number;
  completedSteps: number;
  totalSteps: number;
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

/**
 * 解析出默认的预览版本（优先用当前选中的，没有则用最新的 ready 版本）
 */
export function resolvePreviewVersion(folder: FolderIconCandidate): IconPreviewVersion | null {
  if (folder.current_version_id) {
    const current = folder.versions.find((version) => version.version_id === folder.current_version_id);
    if (current) {
      return current;
    }
  }
  return [...folder.versions]
    .filter((version) => version.status === "ready")
    .sort((a, b) => b.version_number - a.version_number)[0] || null;
}

export function getGenerateFlowPresentation(progress: GenerateFlowProgress): GenerateFlowPresentation {
  const totalFolders = Math.max(progress.totalFolders, 1);
  const totalSteps = totalFolders + 2;

  if (progress.stage === "analyzing") {
    return {
      title: `正在分析 ${progress.totalFolders} 个目标文件夹`,
      detail: "先读取目录结构，整理每个文件夹的图标主题。",
      percent: Math.max(8, Math.round((1 / totalSteps) * 100)),
      completedSteps: 1,
      totalSteps,
    };
  }

  if (progress.stage === "applying_template") {
    return {
      title: "正在套用当前风格模板",
      detail: "把你选择的风格写入每个目标的生成提示词。",
      percent: Math.max(16, Math.round((2 / totalSteps) * 100)),
      completedSteps: 2,
      totalSteps,
    };
  }

  const completedFolders = Math.max(0, Math.min(progress.completedFolders, progress.totalFolders));
  const completedSteps = Math.min(totalSteps, 2 + completedFolders);
  const nextIndex = Math.min(progress.totalFolders, completedFolders + 1);
  const finished = completedFolders >= progress.totalFolders;

  return {
    title: finished
      ? "图标预览已全部生成"
      : `正在生成第 ${nextIndex} / ${progress.totalFolders} 个图标`,
    detail: finished
      ? `${progress.totalFolders} 个目标文件夹都已经完成本轮预览生成。`
      : progress.currentFolderName
        ? `当前目标：${progress.currentFolderName}`
        : `已完成 ${completedFolders} / ${progress.totalFolders} 个目标文件夹。`,
    percent: Math.max(22, Math.round((completedSteps / totalSteps) * 100)),
    completedSteps,
    totalSteps,
  };
}
