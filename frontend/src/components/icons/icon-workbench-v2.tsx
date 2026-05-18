"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { AlertCircle, FolderOpen, LoaderCircle, Sparkles, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ErrorAlert } from "@/components/ui/error-alert";
import { ModelConfigBanner } from "@/components/ui/model-config-banner";
import { createApiClient } from "@/lib/api";
import { createIconWorkbenchApiClient } from "@/lib/icon-workbench-api";
import { createIconWorkbenchEventStream, type IconWorkbenchEventStream } from "@/lib/icon-workbench-sse";
import { getApiBaseUrl, getApiToken, inspectPathsWithTauri, invokeTauriCommand, isTauriDesktop, openDirectoryWithTauri, pickDirectoriesWithTauri } from "@/lib/runtime";
import {
  findDropZoneForPosition,
  isTauriDragDropPayload,
  isTauriDragLeavePayload,
  isTauriDragOverPayload,
  listenToTauriDragDrop,
} from "@/lib/tauri-drag-drop";
import { cn } from "@/lib/utils";
import type {
  ApplyIconResult,
  FolderIconCandidate,
  IconWorkbenchClientActionResult,
  IconWorkbenchConfig,
  IconWorkbenchEvent,
  IconWorkbenchHistoryItem,
  IconPreviewVersion,
  IconWorkbenchSession,
} from "@/types/icon-workbench";
import { IconWorkbenchFooterBar } from "./icon-workbench-footer-bar";
import { IconWorkbenchFolderList } from "./icon-workbench-folder-list";
import { IconWorkbenchHistoryDrawer } from "./icon-workbench-history-drawer";
import { IconWorkbenchPreviewModal } from "./icon-workbench-preview-modal";
import { IconWorkbenchStylePanel } from "./icon-workbench-style-panel";
import { IconWorkbenchTemplateDrawer } from "./icon-workbench-template-drawer";
import { IconWorkbenchToolbar } from "./icon-workbench-toolbar";
import {
  buildGenerateFlowSteps,
  buildImageSrc,
  getGenerateFlowPresentation,
  isFolderReady,
  type GenerateFlowProgress,
} from "./icon-workbench-utils";
import { useBackgroundRemoval } from "./use-background-removal";
import { useIconTemplates } from "./use-icon-templates";

const APP_CONTEXT_EVENT = "file-pilot-context-change";
const ICONS_CONTEXT_KEY = "icons_header_context";
const ICONS_WORKSPACE_STATE_KEY = "icons_workspace_state";
type IconWorkbenchStreamStatus = "connecting" | "connected" | "reconnecting" | "offline";

interface PersistedIconsWorkspaceState {
  sessionId: string;
  selectedTemplateId: string;
  expandedFolderId: string | null;
}

interface NoticeState {
  message: string;
  detail: string | null;
  actionPath?: string | null;
}

export default function IconWorkbenchV2() {
  const baseUrl = getApiBaseUrl();
  const apiToken = getApiToken();
  const desktopReady = isTauriDesktop();
  const iconApi = useMemo(() => createIconWorkbenchApiClient(baseUrl, apiToken), [apiToken, baseUrl]);
  const systemApi = useMemo(() => createApiClient(baseUrl, apiToken), [apiToken, baseUrl]);

  const [session, setSession] = useState<IconWorkbenchSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [actionLabel, setActionLabel] = useState<string | null>(null);
  const [generateProgress, setGenerateProgress] = useState<GenerateFlowProgress | null>(null);

  const [expandedFolderId, setExpandedFolderId] = useState<string | null>(null);
  const [stylePanelOpen, setStylePanelOpen] = useState(false);
  const [templateDrawerOpen, setTemplateDrawerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<IconWorkbenchHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [openingHistorySessionId, setOpeningHistorySessionId] = useState<string | null>(null);
  const [deletingHistorySessionId, setDeletingHistorySessionId] = useState<string | null>(null);
  const [pendingDeleteHistorySessionId, setPendingDeleteHistorySessionId] = useState<string | null>(null);
  const [previewVersion, setPreviewVersion] = useState<IconPreviewVersion | null>(null);

  const [activeProcessingId, setActiveProcessingId] = useState<string | null>(null);
  const [isApplyingId, setIsApplyingId] = useState<string | null>(null);
  const [batchApplyLoading, setBatchApplyLoading] = useState(false);

  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [folderToRestore, setFolderToRestore] = useState<FolderIconCandidate | null>(null);
  const [restoringSession, setRestoringSession] = useState(true);

  const [workbenchConfig, setWorkbenchConfig] = useState<IconWorkbenchConfig | null>(null);
  const streamRef = useRef<IconWorkbenchEventStream | null>(null);
  const offlineTimerRef = useRef<number | null>(null);
  const noticeFadeTimerRef = useRef<number | null>(null);
  const noticeDismissTimerRef = useRef<number | null>(null);
  const hasConnectedRef = useRef(false);
  const hasUserInteractedRef = useRef(false);
  const [streamStatus, setStreamStatus] = useState<IconWorkbenchStreamStatus>("offline");
  const [isNoticeFading, setIsNoticeFading] = useState(false);
  const [isTargetDropActive, setIsTargetDropActive] = useState(false);
  const [isDraggingGlobal, setIsDraggingGlobal] = useState(false);
  const targetDropZoneRef = useRef<HTMLDivElement | null>(null);
  const handledImportPathsRef = useRef<string | null>(null);

  const searchParams = useSearchParams();
  const router = useRouter();

  const clearNoticeTimers = useCallback(() => {
    if (noticeFadeTimerRef.current !== null) {
      window.clearTimeout(noticeFadeTimerRef.current);
      noticeFadeTimerRef.current = null;
    }
    if (noticeDismissTimerRef.current !== null) {
      window.clearTimeout(noticeDismissTimerRef.current);
      noticeDismissTimerRef.current = null;
    }
  }, []);

  const showNotice = useCallback((message: string | null, detail?: string | null, actionPath?: string | null) => {
    clearNoticeTimers();
    setIsNoticeFading(false);
    if (!message) {
      setNotice(null);
      return;
    }
    setNotice({
      message,
      detail: detail?.trim() || null,
      actionPath: actionPath?.trim() || null,
    });
  }, [clearNoticeTimers]);

  useEffect(() => {
    clearNoticeTimers();
    if (!notice?.message) return;
    noticeFadeTimerRef.current = window.setTimeout(() => {
      setIsNoticeFading(true);
      noticeFadeTimerRef.current = null;
    }, 2600);
    noticeDismissTimerRef.current = window.setTimeout(() => {
      setNotice(null);
      setIsNoticeFading(false);
      noticeDismissTimerRef.current = null;
    }, 2960);
    return clearNoticeTimers;
  }, [clearNoticeTimers, notice]);

  useEffect(() => {
    iconApi.getConfig().then((payload) => setWorkbenchConfig(payload.config)).catch(() => setWorkbenchConfig(null));
  }, [iconApi]);

  const isTextModelConfigured = useMemo(() => {
    if (!workbenchConfig) return true;
    const m = workbenchConfig.text_model;
    return Boolean(m?.configured || (m?.secret_state === "stored" && m?.model));
  }, [workbenchConfig]);

  const isImageModelConfigured = useMemo(() => {
    if (!workbenchConfig) return true;
    const m = workbenchConfig.image_model;
    return Boolean(m?.configured || (m?.secret_state === "stored" && m?.model));
  }, [workbenchConfig]);

  const generationConfigBannerProps = useMemo(() => {
    if (!isTextModelConfigured) {
      return {
        title: "AI 文本模型尚未配置",
        message: "未配置文本模型时，系统无法稳定完成目录分析和图标提示词生成。建议先前往“设置 > 文本模型”完成配置。",
        actionLabel: "去配置文本模型",
        href: "/settings?tab=text",
      };
    }
    if (!isImageModelConfigured) {
      return {
        title: "AI 生图模型尚未配置",
        message: "未配置生图模型时，系统无法生成图标预览。建议先前往“设置 > 图标生图”完成配置。",
        actionLabel: "去配置图标生图",
        href: "/settings?tab=icon_image",
      };
    }
    return null;
  }, [isImageModelConfigured, isTextModelConfigured]);

  const {
    templates,
    templatesLoading,
    templatesInitialized,
    selectedTemplateId,
    setSelectedTemplateId,
    selectedTemplate,
    templateActionLoading,
    templateNameDraft,
    setTemplateNameDraft,
    templateDescriptionDraft,
    setTemplateDescriptionDraft,
    templatePromptDraft,
    setTemplatePromptDraft,
    reloadTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
  } = useIconTemplates({ iconApi, setError, showNotice });

  const {
    processingBgVersionIds,
    isRemovingBgBatch,
    batchProgress: removeBgBatchProgress,
    handleRemoveBg,
    handleRemoveBgBatch,
  } = useBackgroundRemoval({
    desktopReady,
    session,
    setSession,
    setError,
    showNotice,
  });

  const targetCount = session?.folders.length ?? 0;
  const hasTargets = targetCount > 0;
  const isGeneratingFlow = Boolean(generateProgress);
  const isBusy = Boolean(actionLabel) || isGeneratingFlow;
  const pendingDeleteHistorySession = useMemo(
    () => historyItems.find((item) => item.session_id === pendingDeleteHistorySessionId) ?? null,
    [historyItems, pendingDeleteHistorySessionId],
  );
  const generatePresentation = useMemo(
    () => (generateProgress ? getGenerateFlowPresentation(generateProgress) : null),
    [generateProgress],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const detail = hasTargets ? `工作区 · ${targetCount} 个目标` : "准备就绪";
    window.localStorage.setItem(ICONS_CONTEXT_KEY, JSON.stringify({ detail }));
    window.dispatchEvent(new Event(APP_CONTEXT_EVENT));
  }, [hasTargets, targetCount]);

  const hasSelectedStyle = Boolean(selectedTemplate);
  const allFolderIds = useMemo(() => session?.folders.map((folder) => folder.folder_id) ?? [], [session]);
  const latestTargetPath = useMemo(() => {
    const lastPath = session?.target_paths.at(-1);
    if (lastPath) return lastPath;
    return session?.folders.at(-1)?.folder_path || null;
  }, [session]);
  const canApplyBatch = useMemo(() => {
    if (!session) return false;
    return session.folders.some((folder) => isFolderReady(folder));
  }, [session]);
  const canRemoveBgBatch = canApplyBatch;
  const previewFolder = useMemo(
    () => session?.folders.find((folder) => folder.versions.some((version) => version.version_id === previewVersion?.version_id)) ?? null,
    [previewVersion?.version_id, session],
  );

  const applySession = useCallback((nextSession: IconWorkbenchSession) => {
    setSession(nextSession);
    setExpandedFolderId((current) => (current && nextSession.folders.some((f) => f.folder_id === current) ? current : null));
    setPreviewVersion((current) => {
      if (!current) return null;
      const exists = nextSession.folders.some((f) => f.versions.some((v) => v.version_id === current.version_id));
      return exists ? current : null;
    });
  }, []);

  const clearCurrentSession = useCallback(() => {
    setSession(null);
    setExpandedFolderId(null);
    setPreviewVersion(null);
    setGenerateProgress(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(ICONS_WORKSPACE_STATE_KEY);
    }
  }, []);

  const reloadHistoryItems = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setHistoryItems(await iconApi.listSessions());
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "读取历史工作区失败");
    } finally {
      setHistoryLoading(false);
    }
  }, [iconApi]);

  const handleOpenHistoryDrawer = useCallback(() => {
    setHistoryOpen(true);
    void reloadHistoryItems();
  }, [reloadHistoryItems]);

  const handleOpenHistorySession = useCallback(async (sessionId: string) => {
    setOpeningHistorySessionId(sessionId);
    setHistoryError(null);
    try {
      const nextSession = await iconApi.getSession(sessionId);
      applySession(nextSession);
      setHistoryOpen(false);
      showNotice("已打开历史图标工作区。");
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "打开历史工作区失败");
    } finally {
      setOpeningHistorySessionId(null);
    }
  }, [applySession, iconApi, showNotice]);

  const handleDeleteHistorySession = useCallback(async (sessionId: string) => {
    setDeletingHistorySessionId(sessionId);
    setHistoryError(null);
    try {
      await iconApi.deleteSession(sessionId);
      setHistoryItems((current) => current.filter((item) => item.session_id !== sessionId));
      if (session?.session_id === sessionId) {
        clearCurrentSession();
        showNotice("已删除当前历史工作区，图标工坊已清空。");
      } else {
        showNotice("已删除历史工作区。");
      }
      return true;
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "删除历史工作区失败");
      return false;
    } finally {
      setDeletingHistorySessionId(null);
    }
  }, [clearCurrentSession, iconApi, session?.session_id, showNotice]);

  const confirmDeleteHistorySession = useCallback(async () => {
    if (!pendingDeleteHistorySessionId) {
      return;
    }
    const ok = await handleDeleteHistorySession(pendingDeleteHistorySessionId);
    if (ok) {
      setPendingDeleteHistorySessionId(null);
    }
  }, [handleDeleteHistorySession, pendingDeleteHistorySessionId]);

  const clearOfflineTimer = useCallback(() => {
    if (offlineTimerRef.current !== null) {
      window.clearTimeout(offlineTimerRef.current);
      offlineTimerRef.current = null;
    }
  }, []);

  const scheduleOfflineState = useCallback(() => {
    clearOfflineTimer();
    offlineTimerRef.current = window.setTimeout(() => setStreamStatus("offline"), 5000);
  }, [clearOfflineTimer]);

  const closeEventStream = useCallback(() => {
    streamRef.current?.close();
    streamRef.current = null;
    hasConnectedRef.current = false;
    clearOfflineTimer();
  }, [clearOfflineTimer]);

  const handleWorkbenchEvent = useCallback((event: IconWorkbenchEvent) => {
    clearOfflineTimer();
    hasConnectedRef.current = true;
    setStreamStatus("connected");
    if (event.session_snapshot) applySession(event.session_snapshot);
    if (event.progress) {
      const progress = event.progress;
      const nextStage = (progress.stage === "analyzing" || progress.stage === "applying_template" || progress.stage === "generating") ? progress.stage : "generating";
      setGenerateProgress((current) => ({
        stage: nextStage,
        totalFolders: progress.totalFolders,
        completedFolders: progress.completedFolders,
        currentFolderId: progress.currentFolderId,
        currentFolderName: progress.currentFolderName,
        steps: current?.steps?.length ? current.steps : [nextStage],
      }));
    }
  }, [applySession, clearOfflineTimer]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(ICONS_WORKSPACE_STATE_KEY);
    if (!raw) { setRestoringSession(false); return; }
    try {
      const parsed = JSON.parse(raw) as PersistedIconsWorkspaceState;
      if (!parsed?.sessionId) { setRestoringSession(false); return; }
      if (parsed.selectedTemplateId) setSelectedTemplateId(parsed.selectedTemplateId);
      setExpandedFolderId(parsed.expandedFolderId);
      iconApi.getSession(parsed.sessionId).then((nextSession) => {
        applySession(nextSession);
        if (nextSession.folders.length > 0 && !hasUserInteractedRef.current) {
          showNotice("已恢复上次图标工作区，目标列表和展开状态已还原。");
        }
      }).catch(() => window.localStorage.removeItem(ICONS_WORKSPACE_STATE_KEY)).finally(() => setRestoringSession(false));
    } catch {
      setRestoringSession(false);
    }
  }, [applySession, iconApi, setSelectedTemplateId, showNotice]);

  useEffect(() => {
    if (restoringSession || !session) return;
    const payload = { sessionId: session.session_id, selectedTemplateId, expandedFolderId };
    window.localStorage.setItem(ICONS_WORKSPACE_STATE_KEY, JSON.stringify(payload));
  }, [expandedFolderId, restoringSession, selectedTemplateId, session]);

  useEffect(() => {
    if (!session?.session_id) { closeEventStream(); setStreamStatus("offline"); return; }
    closeEventStream();
    setStreamStatus("connecting");
    scheduleOfflineState();
    streamRef.current = createIconWorkbenchEventStream({ baseUrl, sessionId: session.session_id, accessToken: apiToken, onEvent: handleWorkbenchEvent, onError: () => { setStreamStatus("reconnecting"); showNotice("图标工坊实时连接已断开，当前进度可能不是最新状态。"); scheduleOfflineState(); } });
    return closeEventStream;
  }, [apiToken, baseUrl, closeEventStream, handleWorkbenchEvent, scheduleOfflineState, session?.session_id]);

  const generationConfigBlockedReason = !isTextModelConfigured ? "请先在设置中配置文本模型" : !isImageModelConfigured ? "请先在设置中配置图标生图模型" : null;
  const generateBlockedReason = !hasTargets ? "先选择目标文件夹" : !hasSelectedStyle ? "先选择风格模板" : generationConfigBlockedReason || (isBusy ? "正在生成..." : null);

  const appendTargetPaths = useCallback(async (nextTargetPaths: string[]) => {
    if (nextTargetPaths.length === 0) return;
    setError(null);
    setActionLabel(session ? "正在添加目标..." : "正在创建任务...");
    try {
      const nextSession = session ? await iconApi.updateTargets(session.session_id, { target_paths: nextTargetPaths, mode: "append" }) : await iconApi.createSession(nextTargetPaths);
      applySession(nextSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : "载入文件夹失败");
    } finally { setActionLabel(null); }
  }, [applySession, iconApi, session]);

  const handleChooseTargets = useCallback(async () => {
    setError(null);
    try {
      const selectedPaths = desktopReady ? await pickDirectoriesWithTauri() : null;
      const selectedPath = desktopReady ? null : (await systemApi.selectDir()).path;
      const paths = selectedPaths ?? (selectedPath ? [selectedPath] : []);
      if (paths?.length) await appendTargetPaths(paths);
    } catch (err) { setError(err instanceof Error ? err.message : "选择目标失败"); }
  }, [appendTargetPaths, desktopReady, systemApi]);

  const handleTargetDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault(); setIsTargetDropActive(false);
    const paths = Array.from(event.dataTransfer.files).map((f) => (f as any).path || f.name).filter(Boolean);
    if (paths.length) await appendTargetPaths(paths);
  }, [appendTargetPaths]);

  const appendTargetPathsRef = useRef(appendTargetPaths);
  useEffect(() => {
    appendTargetPathsRef.current = appendTargetPaths;
  }, [appendTargetPaths]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void listenToTauriDragDrop((event) => {
      const payload = event.payload;
      if (isTauriDragLeavePayload(payload)) {
        setIsTargetDropActive(false);
        setIsDraggingGlobal(false);
        return;
      }

      const zone = findDropZoneForPosition(payload.position, [
        { key: "target", element: targetDropZoneRef.current },
      ]);

      if (isTauriDragOverPayload(payload)) {
        setIsDraggingGlobal(true);
        setIsTargetDropActive(zone === "target");
        return;
      }

      if (!isTauriDragDropPayload(payload)) {
        return;
      }

      setIsDraggingGlobal(false);
      setIsTargetDropActive(false);

      if (zone === "target") {
        if (payload.paths && payload.paths.length > 0) {
          void appendTargetPathsRef.current(payload.paths);
        }
      }
    }).then((dispose) => {
      if (cancelled) {
        dispose?.();
        return;
      }
      unlisten = dispose;
    });

    return () => {
      cancelled = true;
      setIsTargetDropActive(false);
      setIsDraggingGlobal(false);
      unlisten?.();
    };
  }, []);

  const handleResetWorkbench = async () => {
    if (!session) {
      setResetConfirmOpen(false);
      return;
    }
    setActionLabel("正在重置...");
    setError(null);
    try {
      applySession(await iconApi.updateTargets(session.session_id, { target_paths: [], mode: "replace" }));
      setResetConfirmOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "重置工作台失败");
    } finally {
      setActionLabel(null);
    }
  };

  const runGenerateFlow = async (folderIds: string[]) => {
    if (!session || !folderIds.length || !selectedTemplateId) return;
    setError(null);
    try {
      const foldersToAnalyze = folderIds.filter(id => session.folders.find(f => f.folder_id === id)?.analysis_status !== "ready");
      const steps = buildGenerateFlowSteps(foldersToAnalyze.length > 0);
      setGenerateProgress({ stage: steps[0], totalFolders: folderIds.length, completedFolders: 0, currentFolderId: null, currentFolderName: null, steps });
      
      let nextSession = session;
      if (foldersToAnalyze.length > 0) {
        nextSession = await iconApi.analyzeFolders(session.session_id, foldersToAnalyze);
        applySession(nextSession);
      }
      
      nextSession = await iconApi.applyTemplate(session.session_id, selectedTemplateId, folderIds);
      applySession(nextSession);
      
      nextSession = await iconApi.generatePreviews(session.session_id, folderIds);
      applySession(nextSession);
      const generatedFolders = nextSession.folders.filter((folder) => folderIds.includes(folder.folder_id));
      const successCount = generatedFolders.filter((folder) => {
        const currentVersion = folder.versions.find((version) => version.version_id === folder.current_version_id);
        return currentVersion?.status === "ready";
      }).length;
      const failedFolders = generatedFolders.filter((folder) => {
        const currentVersion = folder.versions.find((version) => version.version_id === folder.current_version_id);
        return currentVersion?.status === "error";
      });
      const failedCount = failedFolders.length;
      const skippedCount = Math.max(0, folderIds.length - successCount - failedCount);
      const failedDetail = failedFolders.length
        ? `生成失败：${failedFolders.map((folder) => `「${folder.folder_name}」`).join("、")}。`
        : null;
      showNotice(`图标生成已完成：成功 ${successCount}，失败 ${failedCount}，跳过 ${skippedCount}。`, failedDetail);
    } catch (err) { setError(err instanceof Error ? err.message : "生成失败"); } finally { setGenerateProgress(null); }
  };

  const reportClientAction = async (
    type: string,
    results: IconWorkbenchClientActionResult[],
    skippedItems: IconWorkbenchClientActionResult[] = [],
  ) => {
    if (!session) return null;
    return iconApi.reportClientAction(session.session_id, { action_type: type, results, skipped_items: skippedItems }).catch(() => null);
  };

  const syncAfterClientActionReportFailure = async (
    successMessage: string,
    failureMessage: string,
    actionPath?: string | null,
  ) => {
    if (!session) {
      setError(failureMessage);
      return null;
    }
    try {
      const syncedSession = await iconApi.scanSession(session.session_id);
      applySession(syncedSession);
      showNotice(successMessage, "服务端动作记录失败，已重新扫描当前工作区。", actionPath ?? null);
      return syncedSession;
    } catch (err) {
      const detail = err instanceof Error ? err.message : "重新同步失败";
      setError(`${failureMessage}：${detail}`);
      return null;
    }
  };

  const handleApplyVersion = async (folderId: string, version: IconPreviewVersion) => {
    if (!session || !desktopReady) return;
    setActiveProcessingId(folderId); setIsApplyingId(version.version_id);
    try {
      const folder = session.folders.find(f => f.folder_id === folderId);
      if (!folder) return;
      await invokeTauriCommand("apply_folder_icon", { folderPath: folder.folder_path, imagePath: version.image_path });
      try {
        const nextSession = await iconApi.selectVersion(session.session_id, folderId, version.version_id);
        applySession(nextSession);
        showNotice(`「${folder.folder_name}」图标已更新`, null, folder.folder_path);
      } catch {
        const syncedSession = await iconApi.scanSession(session.session_id);
        applySession(syncedSession);
        showNotice(`「${folder.folder_name}」图标已应用，工作区状态已重新同步。`, null, folder.folder_path);
      }
    } catch (err) { setError(err instanceof Error ? err.message : "应用失败"); } finally { setActiveProcessingId(null); setIsApplyingId(null); }
  };

  const handleRemoveTarget = async (folderId: string) => {
    if (!session) return;
    setActionLabel("正在移除...");
    try {
      applySession(await iconApi.removeTarget(session.session_id, folderId));
    } catch (err) { setError(err instanceof Error ? err.message : "移除失败"); } finally { setActionLabel(null); }
  };

  const handleDeleteVersion = async (folderId: string, versionId: string) => {
    if (!session) return;
    setActionLabel("正在删除版本...");
    try {
      applySession(await iconApi.deleteVersion(session.session_id, folderId, versionId));
      showNotice("已删除该图标版本");
    } catch (err) { setError(err instanceof Error ? err.message : "删除失败"); } finally { setActionLabel(null); }
  };

  const handleSelectVersion = async (folderId: string, versionId: string) => {
    if (!session) return;
    setActionLabel("正在切换版本...");
    setError(null);
    try {
      applySession(await iconApi.selectVersion(session.session_id, folderId, versionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换版本失败");
    } finally {
      setActionLabel(null);
    }
  };

  const handleRestoreIcon = async (folder: FolderIconCandidate) => {
    if (!desktopReady) return;
    setActionLabel("正在恢复...");
    setError(null);
    try {
      await invokeTauriCommand("restore_last_folder_icon", { folderPath: folder.folder_path });
      const nextSession = await reportClientAction("restore_icons", [{ folder_id: folder.folder_id, status: "restored", message: "已恢复上一次图标状态" }]);
      if (nextSession) {
        applySession(nextSession);
        showNotice(`「${folder.folder_name}」已恢复`);
      } else if (session) {
        await syncAfterClientActionReportFailure(
          `「${folder.folder_name}」已恢复上一次图标状态，工作区状态已重新同步。`,
          "图标已恢复，但工作区状态同步失败",
          folder.folder_path,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "恢复失败");
    } finally {
      setActionLabel(null);
    }
  };

  const handleApplyBatch = async () => {
    if (!session) return;
    if (!desktopReady) {
      setError("批量应用图标需要在桌面版中使用。");
      return;
    }
    hasUserInteractedRef.current = true;
    setError(null);
    setBatchApplyLoading(true);
    try {
      const prep = await iconApi.prepareApplyReady(session.session_id, allFolderIds);
      const rawResults = await invokeTauriCommand<ApplyIconResult[]>("apply_ready_icons", { tasks: prep.tasks });
      const taskByFolderId = new Map(prep.tasks.map((task) => [task.folder_id, task] as const));
      const results = (rawResults ?? []).map((result) => {
        const task = result.folder_id ? taskByFolderId.get(result.folder_id) : null;
        return {
          ...result,
          version_id: result.version_id ?? task?.version_id ?? null,
        };
      });
      const nextSession = await reportClientAction("apply_icons", results, prep.skipped_items);
      if (nextSession) {
        applySession(nextSession);
        const appliedFolderPath = results.find((result) => result.status === "applied" && result.folder_path)?.folder_path;
        showNotice(nextSession.last_client_action?.summary.message ?? "批量应用已完成", null, appliedFolderPath ?? null);
      } else {
        const appliedFolderPath = results.find((result) => result.status === "applied" && result.folder_path)?.folder_path;
        await syncAfterClientActionReportFailure(
          "批量应用已执行，工作区状态已重新同步。",
          "图标已应用，但服务端记录动作失败且重新同步失败",
          appliedFolderPath ?? null,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量应用失败");
    } finally {
      setBatchApplyLoading(false);
    }
  };

  const retryEventStream = useCallback(async () => {
    if (!session?.session_id) return;
    closeEventStream();
    setStreamStatus("connecting");
    streamRef.current = createIconWorkbenchEventStream({ baseUrl, sessionId: session.session_id, accessToken: apiToken, onEvent: handleWorkbenchEvent, onError: () => setStreamStatus("reconnecting") });
    iconApi.getSession(session.session_id).then(applySession).catch(() => setError("重新连接失败"));
  }, [apiToken, applySession, baseUrl, closeEventStream, handleWorkbenchEvent, iconApi, session?.session_id]);

  const shouldShowNotice = Boolean(notice?.message);
  
  const statusRail = (error || shouldShowNotice || generationConfigBlockedReason || (streamStatus !== "connected" && session)) ? (
    <div className="flex flex-col">
      {error ? (
        <div className="flex h-8 items-center justify-between gap-4 border-b bg-error/5 px-5 text-error">
          <div className="flex min-w-0 items-center gap-2">
            <AlertCircle className="h-3 w-3 shrink-0" />
            <p className="truncate text-[11px] font-bold">{error}</p>
          </div>
        </div>
      ) : generationConfigBlockedReason && generationConfigBannerProps ? (
        <div className="border-b border-on-surface/8 bg-surface px-5 py-3">
          <ModelConfigBanner {...generationConfigBannerProps} />
        </div>
      ) : null}
      {streamStatus !== "connected" && session && (
        <div className={cn("flex h-7 items-center justify-between border-b px-5 bg-on-surface/[0.02]")}>
          <div className="flex items-center gap-2">
            <div className={cn("h-1 w-1 rounded-full", streamStatus === "reconnecting" ? "animate-pulse bg-warning" : "bg-on-surface/20")} />
            <p className="text-[10px] font-medium text-on-surface/40 uppercase tracking-tight">{streamStatus === "connecting" ? "连接中" : streamStatus === "reconnecting" ? "重连中" : "离线模式"}</p>
          </div>
          <button onClick={retryEventStream} className="text-[9px] font-black uppercase tracking-widest text-primary/60">重新连接</button>
        </div>
      )}
      {shouldShowNotice && (
        <div className={cn("flex h-8 items-center gap-3 border-b border-primary/10 bg-primary/[0.03] px-5 transition-all text-on-surface/70", isNoticeFading ? "opacity-0" : "opacity-100")}>
          <Sparkles className="h-3 w-3 shrink-0 text-primary opacity-50" />
          <p className="truncate text-[11px] font-bold flex-1">
            {notice?.message}
            {notice?.detail ? <span className="ml-2 text-ui-muted/60">{notice.detail}</span> : null}
          </p>
          {desktopReady && notice?.actionPath ? (
            <button
              onClick={() => openDirectoryWithTauri(notice.actionPath || "")}
              className="flex h-5 shrink-0 items-center gap-1 rounded bg-primary/10 px-2 text-[9px] font-black uppercase text-primary hover:bg-primary/20"
            >
              <FolderOpen className="h-3 w-3" />
              打开查看
            </button>
          ) : null}
          <button onClick={() => showNotice(null)} className="text-ui-muted/30 hover:text-on-surface" title="忽略通知"><X className="h-3 w-3" /></button>
        </div>
      )}
    </div>
  ) : null;

  const processingBanner = generatePresentation ? (
    <div className="border-b border-primary/10 bg-surface-container-lowest px-5 py-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <LoaderCircle className="h-3 w-3 animate-spin text-primary" />
          <div className="min-w-0 flex-1 flex items-center gap-2">
            <span className="text-[9px] font-black uppercase tracking-widest text-primary/40 shrink-0">正在生成</span>
            <p className="truncate text-[11.5px] font-black text-on-surface/80">{generatePresentation.title}</p>
            <span className="text-[10px] font-medium text-ui-muted/40 truncate shrink-0">{generatePresentation.detail}</span>
            {generatePresentation.steps.map((step) => (
              <span key={step.key} className="text-[9px] font-bold text-ui-muted/35">
                {step.label}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[9.5px] font-bold tabular-nums text-primary/60">{generatePresentation.counter}</span>
          <div className="h-1 w-16 overflow-hidden rounded-full bg-primary/10">
            <div className="h-full bg-primary transition-all duration-500" style={{ width: `${generatePresentation.percent}%` }} />
          </div>
        </div>
      </div>
    </div>
  ) : actionLabel ? (
    <div className="flex h-7 items-center gap-2 bg-primary/[0.04] border-b border-primary/8 px-5">
      <LoaderCircle className="h-2.5 w-2.5 animate-spin text-primary" />
      <span className="text-[9px] font-black uppercase tracking-[0.2em] text-primary/70">{actionLabel}</span>
    </div>
  ) : null;
  const isLoading = (!templatesInitialized && templatesLoading) || restoringSession;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-surface">
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden antialiased">
        <AnimatePresence mode="wait">
          {isLoading ? (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-1 items-center justify-center bg-surface">
              <div className="flex flex-col items-center gap-3">
                <LoaderCircle className="h-8 w-8 animate-spin text-primary/20" />
                <p className="text-[12px] font-bold text-on-surface/40 uppercase tracking-widest">正在恢复图标工坊...</p>
              </div>
            </motion.div>
          ) : (
            <motion.div key="main" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-1 flex-col overflow-hidden">
              <IconWorkbenchToolbar targetCount={targetCount} latestTargetPath={latestTargetPath} onAddTargets={handleChooseTargets} onClearTargets={() => setResetConfirmOpen(true)} onOpenHistory={handleOpenHistoryDrawer} onOpenStylePanel={() => setStylePanelOpen(true)} onOpenTemplateDrawer={() => setTemplateDrawerOpen(true)} selectedTemplateName={selectedTemplate?.name || "请选择风格"} />
              {statusRail}
              {processingBanner}
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <IconWorkbenchFolderList
                  folders={session?.folders || []}
                  expandedFolderId={expandedFolderId}
                  onToggleExpand={setExpandedFolderId}
                  onSelectVersion={(fid, vid) => void handleSelectVersion(fid, vid)}
                  onZoom={setPreviewVersion}
                  onApplyVersion={handleApplyVersion}
                  onRegenerate={(fid) => void runGenerateFlow([fid])}
                  onRestore={(fid) => {
                    const f = session?.folders.find((i) => i.folder_id === fid);
                    if (f) {
                      setFolderToRestore(f);
                      setRestoreConfirmOpen(true);
                    }
                  }}
                  onRemoveTarget={handleRemoveTarget}
                  onRemoveBg={handleRemoveBg}
                  onDeleteVersion={handleDeleteVersion}
                  processingBgVersionIds={processingBgVersionIds}
                  baseUrl={baseUrl}
                  apiToken={apiToken}
                  isApplyingId={isApplyingId}
                  activeProcessingId={activeProcessingId}
                  desktopReady={desktopReady}
                  hasSelectedStyle={hasSelectedStyle}
                  generateBlockedReason={generationConfigBlockedReason}
                  isProcessing={isBusy}
                  processingFolderId={generateProgress?.currentFolderId ?? null}
                  onAddTargets={handleChooseTargets}
                  isTargetDropActive={isTargetDropActive}
                  onTargetDrop={handleTargetDrop}
                  onTargetDragOver={(e) => {
                    e.preventDefault();
                    setIsTargetDropActive(true);
                  }}
                  onTargetDragLeave={() => setIsTargetDropActive(false)}
                  dropZoneRef={targetDropZoneRef}
                />
              </div>

              <IconWorkbenchFooterBar
                targetCount={targetCount}
                isGenerating={isGeneratingFlow}
                generateProgressHint={generatePresentation?.detail || null}
                isApplying={batchApplyLoading}
                onGenerate={() => void runGenerateFlow(allFolderIds)}
                onApplyBatch={() => void handleApplyBatch()}
                canApplyBatch={canApplyBatch && desktopReady}
                onRemoveBgBatch={handleRemoveBgBatch}
                canRemoveBgBatch={canRemoveBgBatch}
                isRemovingBgBatch={isRemovingBgBatch}
                removeBgBatchProgress={removeBgBatchProgress}
                selectedTemplateName={selectedTemplate?.name || null}
                generateBlockedReason={generateBlockedReason}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <IconWorkbenchStylePanel isOpen={stylePanelOpen} onClose={() => setStylePanelOpen(false)} templates={templates} selectedTemplateId={selectedTemplateId} onSelect={setSelectedTemplateId} onRequestManageTemplate={(id) => { setSelectedTemplateId(id); setStylePanelOpen(false); setTemplateDrawerOpen(true); }} />
      <IconWorkbenchTemplateDrawer open={templateDrawerOpen} templates={templates} templatesLoading={templatesLoading} selectedTemplate={selectedTemplate} templateNameDraft={templateNameDraft} templateDescriptionDraft={templateDescriptionDraft} templatePromptDraft={templatePromptDraft} templateActionLoading={templateActionLoading} onClose={() => setTemplateDrawerOpen(false)} onSelectTemplate={setSelectedTemplateId} onTemplateNameChange={setTemplateNameDraft} onTemplateDescriptionChange={setTemplateDescriptionDraft} onTemplatePromptChange={setTemplatePromptDraft} onReloadTemplates={() => void reloadTemplates(selectedTemplateId)} onCreateTemplate={createTemplate} onUpdateTemplate={updateTemplate} onDeleteTemplate={deleteTemplate} />
      <IconWorkbenchHistoryDrawer open={historyOpen} items={historyItems} loading={historyLoading} error={historyError} activeSessionId={session?.session_id ?? null} openingSessionId={openingHistorySessionId} deletingSessionId={deletingHistorySessionId} onClose={() => setHistoryOpen(false)} onReload={() => void reloadHistoryItems()} onOpenSession={(sessionId) => void handleOpenHistorySession(sessionId)} onDeleteSession={setPendingDeleteHistorySessionId} />
      
      {previewVersion && (
        <IconWorkbenchPreviewModal src={buildImageSrc(previewVersion, baseUrl, apiToken)} title={`v${previewVersion.version_number}`} subtitle={selectedTemplate?.name || "预览"} localImagePath={previewVersion.image_path} folderName={previewFolder?.folder_name || "预览"} folderPath={previewFolder?.folder_path || ""} onOpenFolder={openDirectoryWithTauri} onClose={() => setPreviewVersion(null)} onApply={() => previewFolder && handleApplyVersion(previewFolder.folder_id, previewVersion)} onRegenerate={() => previewFolder && runGenerateFlow([previewFolder.folder_id])} regenerateDisabled={!!generationConfigBlockedReason || isBusy || !previewFolder} isApplying={isApplyingId === previewVersion.version_id} imageModelName={workbenchConfig?.image_model.model || "默认模型"} isApplied={previewFolder?.applied_version_id === previewVersion.version_id} isCurrentVersion={previewFolder?.current_version_id === previewVersion.version_id} />
      )}

      <ConfirmDialog open={restoreConfirmOpen} title="恢复上一次图标状态？" description={`确定要将「${folderToRestore?.folder_name}」恢复到进入前状态吗？`} loading={actionLabel === "正在恢复..."} onClose={() => setRestoreConfirmOpen(false)} onConfirm={async () => { if (folderToRestore) await handleRestoreIcon(folderToRestore); setRestoreConfirmOpen(false); }} />
      <ConfirmDialog open={resetConfirmOpen} title="重置工作台？" description="确定要清空当前所有目标文件夹吗？此操作不会删除文件。" loading={actionLabel === "正在重置..."} onClose={() => setResetConfirmOpen(false)} onConfirm={handleResetWorkbench} />
      <ConfirmDialog
        open={Boolean(pendingDeleteHistorySessionId)}
        title="删除历史工作区？"
        description={pendingDeleteHistorySessionId === session?.session_id
          ? "删除的是当前打开的图标工作区。确认后会清空当前界面，并移除本地恢复记录，操作无法撤销。"
          : `确定要删除「${pendingDeleteHistorySession?.target_paths?.[0] || "这个历史工作区"}」吗？删除后将无法从历史列表继续打开。`}
        confirmLabel="确认删除"
        cancelLabel="取消"
        tone="danger"
        loading={Boolean(deletingHistorySessionId)}
        onConfirm={confirmDeleteHistorySession}
        onCancel={() => setPendingDeleteHistorySessionId(null)}
      />
    </div>
  );
}
