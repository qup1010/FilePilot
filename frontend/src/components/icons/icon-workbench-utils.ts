import type { FolderIconCandidate, IconPreviewVersion, IconWorkbenchSession } from "@/types/icon-workbench";

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
