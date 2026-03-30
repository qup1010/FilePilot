"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";

import { getApiBaseUrl, invokeTauriCommand } from "@/lib/runtime";
import type { IconPreviewVersion, IconWorkbenchSession } from "@/types/icon-workbench";

const HF_BG_TOKEN_STORAGE_KEY = "file_organizer__hf_bg_token";
const HF_BG_TOKEN_LEGACY_STORAGE_KEY = "hf_bg_token";

interface UseBackgroundRemovalOptions {
  desktopReady: boolean;
  session: IconWorkbenchSession | null;
  setSession: Dispatch<SetStateAction<IconWorkbenchSession | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setNotice: Dispatch<SetStateAction<string | null>>;
}

export function useBackgroundRemoval({
  desktopReady,
  session,
  setSession,
  setError,
  setNotice,
}: UseBackgroundRemovalOptions) {
  const [bgApiToken, setBgApiToken] = useState("");
  const [processingBgVersionIds, setProcessingBgVersionIds] = useState<Set<string>>(new Set());
  const [isRemovingBgBatch, setIsRemovingBgBatch] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const namespacedToken = window.localStorage.getItem(HF_BG_TOKEN_STORAGE_KEY);
    const legacyToken = window.localStorage.getItem(HF_BG_TOKEN_LEGACY_STORAGE_KEY);
    const savedToken = namespacedToken || legacyToken;
    if (savedToken) {
      setBgApiToken(savedToken);
      if (!namespacedToken) {
        window.localStorage.setItem(HF_BG_TOKEN_STORAGE_KEY, savedToken);
      }
    }
    if (legacyToken) {
      window.localStorage.removeItem(HF_BG_TOKEN_LEGACY_STORAGE_KEY);
    }
  }, []);

  const handleBgApiTokenChange = useCallback((token: string) => {
    setBgApiToken(token);
    if (typeof window === "undefined") {
      return;
    }
    if (token.trim()) {
      window.localStorage.setItem(HF_BG_TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(HF_BG_TOKEN_STORAGE_KEY);
    }
  }, []);

  const handleRemoveBg = useCallback(async (folderId: string, version: IconPreviewVersion) => {
    if (!desktopReady || !session) {
      setError("抠图功能目前仅支持桌面端。");
      return;
    }

    const processingKey = `${folderId}-${version.version_id}`;
    setProcessingBgVersionIds((prev) => new Set(prev).add(processingKey));

    try {
      // 1. 调用 Tauri 从远端获取移除背景后的字节流（不再覆盖本地文件）
      const processedBytes = await invokeTauriCommand<number[]>("remove_background_for_image", {
        imagePath: version.image_path,
        apiToken: bgApiToken || null,
      });

      if (!processedBytes || processedBytes.length === 0) {
        throw new Error("移除背景返回的数据为空");
      }

      // 2. 将字节流发往后端，注册一个带有 'nobg' 后缀的新版本
      const response = await fetch(
        `${getApiBaseUrl()}/api/icon-workbench/sessions/${session.session_id}/folders/${folderId}/versions/${version.version_id}/add-processed?suffix=nobg`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
          },
          body: new Uint8Array(processedBytes),
        }
      );

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || "注册新版本失败");
      }

      const result = await response.json();
      
      // 3. 更新全量 Session 状态（后端会返回包含新版本的 session）
      if (result.session) {
        setSession(result.session);
      }

      setNotice(`已基于 v${version.version_number} 生成了移除背景的新版本。`);
    } catch (err) {
      setError(`抠图失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setProcessingBgVersionIds((prev) => {
        const next = new Set(prev);
        next.delete(processingKey);
        return next;
      });
    }
  }, [bgApiToken, desktopReady, session, setError, setNotice, setSession]);

  const handleRemoveBgBatch = useCallback(async () => {
    if (!session || session.folders.length === 0 || !desktopReady) {
      return;
    }

    setIsRemovingBgBatch(true);
    let successCount = 0;
    try {
      for (const folder of session.folders) {
        if (!folder.current_version_id) {
          continue;
        }
        const version = folder.versions.find(
          (item) => item.version_id === folder.current_version_id && item.status === "ready",
        );
        if (!version) {
          continue;
        }
        try {
          await handleRemoveBg(folder.folder_id, version);
          successCount += 1;
        } catch (error) {
          console.error(error);
        }
      }
      if (successCount > 0) {
        setNotice(`成功为 ${successCount} 个就绪版本移除背景。`);
      }
    } finally {
      setIsRemovingBgBatch(false);
    }
  }, [desktopReady, handleRemoveBg, session, setNotice]);

  return {
    bgApiToken,
    handleBgApiTokenChange,
    processingBgVersionIds,
    isRemovingBgBatch,
    handleRemoveBg,
    handleRemoveBgBatch,
  };
}
