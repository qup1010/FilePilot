"use client";

import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { createApiClient } from "@/lib/api";
import { getApiBaseUrl, getApiToken, invokeTauriCommand, waitForRuntimeConfig } from "@/lib/runtime";
import type { BackgroundRemovalBatchProgress, IconPreviewVersion, IconWorkbenchSession } from "@/types/icon-workbench";

interface UseBackgroundRemovalOptions {
  desktopReady: boolean;
  session: IconWorkbenchSession | null;
  setSession: Dispatch<SetStateAction<IconWorkbenchSession | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  showNotice: (message: string | null, detail?: string | null) => void;
}

interface RemoveBgOutcome {
  ok: boolean;
  message: string;
}

const BG_BATCH_CONCURRENCY = 2;

export function useBackgroundRemoval({
  desktopReady,
  session,
  setSession,
  setError,
  showNotice,
}: UseBackgroundRemovalOptions) {
  const api = useMemo(() => createApiClient(getApiBaseUrl(), getApiToken()), []);
  const [processingBgVersionIds, setProcessingBgVersionIds] = useState<Set<string>>(new Set());
  const [isRemovingBgBatch, setIsRemovingBgBatch] = useState(false);
  const [batchProgress, setBatchProgress] = useState<BackgroundRemovalBatchProgress | null>(null);

  const loadBgRemovalRuntime = useCallback(async () => {
    return api.getSettingsRuntime<{
      model_id: string;
      api_type: string;
      payload_template: string;
      api_token?: string | null;
    }>("bg_removal");
  }, [api]);

  const removeBackgroundForVersion = useCallback(async (
    folderId: string,
    version: IconPreviewVersion,
    options?: {
      folderName?: string | null;
      showSuccessNotice?: boolean;
      showErrorNotice?: boolean;
    },
  ): Promise<RemoveBgOutcome> => {
    if (!desktopReady || !session) {
      const message = "抠图功能目前仅支持桌面端。";
      if (options?.showErrorNotice ?? true) {
        setError(message);
      }
      return { ok: false, message };
    }

    const processingKey = `${folderId}-${version.version_id}`;
    setProcessingBgVersionIds((prev) => new Set(prev).add(processingKey));

    try {
      const runtime = await waitForRuntimeConfig();
      const runtimeConfig = await loadBgRemovalRuntime();
      const processedB64 = await invokeTauriCommand<string>("remove_background_for_image", {
        imagePath: version.image_path,
        config: {
          modelId: runtimeConfig.model_id,
          apiType: runtimeConfig.api_type,
          payloadTemplate: runtimeConfig.payload_template,
          apiToken: runtimeConfig.api_token ?? null,
        },
      });

      if (!processedB64) {
        throw new Error("移除背景返回的结果为空");
      }

      // decode base64
      const base64Data = processedB64.includes(",") ? processedB64.split(",")[1] : processedB64;
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const response = await fetch(
        `${runtime.base_url?.trim() || getApiBaseUrl()}/api/icon-workbench/sessions/${session.session_id}/folders/${folderId}/versions/${version.version_id}/add-processed?suffix=nobg`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "Authorization": `Bearer ${runtime.api_token?.trim() || getApiToken()}`,
            "x-file-pilot-token": runtime.api_token?.trim() || getApiToken(),
          },
          body: bytes,
        }
      );

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || "注册新版本失败");
      }

      const result = await response.json();
      if (result.session) {
        setSession(result.session);
      }

      const successMessage = options?.folderName
        ? `已为「${options.folderName}」基于 v${version.version_number} 生成去背景版本。`
        : `已基于 v${version.version_number} 生成了移除背景的新版本。`;
      if (options?.showSuccessNotice ?? true) {
        showNotice(successMessage);
      }
      return { ok: true, message: successMessage };
    } catch (err) {
      console.error("抠图异常详情 (Trace):", err);
      const isNetworkError = err instanceof TypeError && err.message === "Failed to fetch";
      const errorMsg = isNetworkError 
        ? "Failed to fetch (无法连接至本地服务，请确认后端 API 是否连接正常且 Token 正确)" 
        : (err instanceof Error ? err.message : String(err));
      const message = `抠图失败: ${errorMsg}`;
      if (options?.showErrorNotice ?? true) {
        setError(message);
      }
      return { ok: false, message };
    } finally {
      setProcessingBgVersionIds((prev) => {
        const next = new Set(prev);
        next.delete(processingKey);
        return next;
      });
    }
  }, [desktopReady, loadBgRemovalRuntime, session, setError, setSession, showNotice]);

  const handleRemoveBg = useCallback(async (folderId: string, version: IconPreviewVersion) => {
    await removeBackgroundForVersion(folderId, version, {
      showSuccessNotice: true,
      showErrorNotice: true,
    });
  }, [removeBackgroundForVersion]);

  const handleRemoveBgBatch = useCallback(async () => {
    if (!session || session.folders.length === 0 || !desktopReady) {
      return;
    }

    const tasks = session.folders.flatMap((folder) => {
      if (!folder.current_version_id) {
        return [];
      }
      const version = folder.versions.find(
        (item) => item.version_id === folder.current_version_id && item.status === "ready",
      );
      if (!version) {
        return [];
      }
      return [{
        folderId: folder.folder_id,
        folderName: folder.folder_name,
        version,
      }];
    });

    if (tasks.length === 0) {
      showNotice("没有可去除背景的就绪版本。");
      return;
    }

    setIsRemovingBgBatch(true);
    setBatchProgress({
      total: tasks.length,
      completed: 0,
      success: 0,
      failed: 0,
      activeFolderNames: [],
    });

    try {
      let nextTaskIndex = 0;
      let successCount = 0;
      let failedCount = 0;
      const worker = async () => {
        while (nextTaskIndex < tasks.length) {
          const task = tasks[nextTaskIndex];
          nextTaskIndex += 1;
          setBatchProgress((current) => {
            if (!current) {
              return current;
            }
            return {
              ...current,
              activeFolderNames: current.activeFolderNames.includes(task.folderName)
                ? current.activeFolderNames
                : [...current.activeFolderNames, task.folderName],
            };
          });
          const outcome = await removeBackgroundForVersion(task.folderId, task.version, {
            folderName: task.folderName,
            showSuccessNotice: false,
            showErrorNotice: false,
          });
          successCount += outcome.ok ? 1 : 0;
          failedCount += outcome.ok ? 0 : 1;
          setBatchProgress((current) => {
            if (!current) {
              return current;
            }
            return {
              ...current,
              completed: current.completed + 1,
              success: current.success + (outcome.ok ? 1 : 0),
              failed: current.failed + (outcome.ok ? 0 : 1),
              activeFolderNames: current.activeFolderNames.filter((name) => name !== task.folderName),
            };
          });
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(BG_BATCH_CONCURRENCY, tasks.length) }, () => worker()),
      );
      const summaryNotice = failedCount > 0
        ? `批量去除背景完成：成功 ${successCount}，失败 ${failedCount}。`
        : `批量去除背景完成：已为 ${successCount} 个目标生成去背景版本。`;
      showNotice(summaryNotice);
    } finally {
      setIsRemovingBgBatch(false);
      setBatchProgress(null);
    }
  }, [desktopReady, removeBackgroundForVersion, session, showNotice]);

  return {
    processingBgVersionIds,
    isRemovingBgBatch,
    batchProgress,
    handleRemoveBg,
    handleRemoveBgBatch,
  };
}
