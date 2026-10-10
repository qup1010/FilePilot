"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, FolderOpen, LoaderCircle, Sparkles, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import i18n from "@/i18n/instance";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ModelConfigBanner } from "@/components/ui/model-config-banner";
import { createApiClient } from "@/lib/api";
import { notifyAppContextChange } from "@/lib/app-context-store";
import { createIconWorkbenchApiClient } from "@/lib/icon-workbench-api";
import { createIconWorkbenchEventStream, type IconWorkbenchEventStream } from "@/lib/icon-workbench-sse";
import { getApiBaseUrl, getApiToken, invokeTauriCommand, isTauriDesktop, openDirectoryWithTauri, pickDirectoriesWithTauri } from "@/lib/runtime";
import {
  findDropZoneForPosition,
  isTauriDragDropPayload,
  isTauriDragLeavePayload,
  isTauriDragOverPayload,
  listenToTauriDragDrop,
} from "@/lib/tauri-drag-drop";
import { localizeUserFacingError } from "@/lib/user-facing-copy";
import { cn } from "@/lib/utils";
import type {
  ApplyIconResult,
  FolderIconCandidate,
  IconWorkbenchClientActionResult,
  IconWorkbenchConfig,
  IconGenerationBlockedReason,
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
  getIconTemplateDisplayName,
  isFolderReady,
  type GenerateFlowProgress,
} from "./icon-workbench-utils";
import { useBackgroundRemoval } from "./use-background-removal";
import { useIconTemplates } from "./use-icon-templates";

const ICONS_CONTEXT_KEY = "icons_header_context";
const ICONS_WORKSPACE_STATE_KEY = "icons_workspace_state";
type IconWorkbenchStreamStatus = "connecting" | "connected" | "reconnecting" | "offline";
type IconWorkbenchActionState =
  | "adding_targets"
  | "creating_session"
  | "resetting"
  | "removing_target"
  | "deleting_version"
  | "switching_version"
  | "restoring_icon";

const ICON_ACTION_LABELS: Record<IconWorkbenchActionState, string> = {
  adding_targets: "iconWorkbench.actions.adding_targets",
  creating_session: "iconWorkbench.actions.creating_session",
  resetting: "iconWorkbench.actions.resetting",
  removing_target: "iconWorkbench.actions.removing_target",
  deleting_version: "iconWorkbench.actions.deleting_version",
  switching_version: "iconWorkbench.actions.switching_version",
  restoring_icon: "iconWorkbench.actions.restoring_icon",
};

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

function isNetworkFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const normalized = err.message.toLowerCase();
  return (
    normalized.includes("failed to fetch")
    || normalized.includes("networkerror")
    || normalized.includes("load failed")
  );
}

function describeWorkbenchError(err: unknown, fallbackKey: string, t: TFunction<"common">): string {
  if (isNetworkFetchError(err)) {
    return t("iconWorkbench.errors.localServiceUnavailable");
  }
  const message = localizeUserFacingError(err, t(fallbackKey));
  return /^(en)(-|$)/i.test(i18n.language) && /[\u3400-\u9fff]/.test(message) ? t(fallbackKey) : message;
}

export default function IconWorkbenchV2() {
  const { t } = useTranslation("common");
  const tRef = useRef(t);
  const baseUrl = getApiBaseUrl();
  const apiToken = getApiToken();
  const desktopReady = isTauriDesktop();
  const iconApi = useMemo(() => createIconWorkbenchApiClient(baseUrl, apiToken), [apiToken, baseUrl]);
  const systemApi = useMemo(() => createApiClient(baseUrl, apiToken), [apiToken, baseUrl]);

  const [session, setSession] = useState<IconWorkbenchSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [actionState, setActionState] = useState<IconWorkbenchActionState | null>(null);
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
  const disconnectNoticeShownRef = useRef(false);
  const [streamStatus, setStreamStatus] = useState<IconWorkbenchStreamStatus>("offline");
  const [isNoticeFading, setIsNoticeFading] = useState(false);
  const [isTargetDropActive, setIsTargetDropActive] = useState(false);
  const [_isDraggingGlobal, setIsDraggingGlobal] = useState(false);
  const targetDropZoneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

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
        title: t("iconWorkbench.config.textModelTitle"),
        message: t("iconWorkbench.config.textModelMessage"),
        actionLabel: t("iconWorkbench.config.textModelAction"),
        href: "/settings?tab=text",
      };
    }
    if (!isImageModelConfigured) {
      return {
        title: t("iconWorkbench.config.imageModelTitle"),
        message: t("iconWorkbench.config.imageModelMessage"),
        actionLabel: t("iconWorkbench.config.imageModelAction"),
        href: "/settings?tab=icon_image",
      };
    }
    return null;
  }, [isImageModelConfigured, isTextModelConfigured, t]);

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
  const selectedTemplateDisplayName = getIconTemplateDisplayName(selectedTemplate, t);

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
  const isBusy = Boolean(actionState) || isGeneratingFlow;
  const pendingDeleteHistorySession = useMemo(
    () => historyItems.find((item) => item.session_id === pendingDeleteHistorySessionId) ?? null,
    [historyItems, pendingDeleteHistorySessionId],
  );
  const generatePresentation = useMemo(
    () => (generateProgress ? getGenerateFlowPresentation(generateProgress, t) : null),
    [generateProgress, t],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const detail = hasTargets
      ? t("iconWorkbench.counts.target", { count: targetCount })
      : t("iconWorkbench.empty.title");
    window.localStorage.setItem(ICONS_CONTEXT_KEY, JSON.stringify({
      detail,
      detail_code: hasTargets ? "targets" : "icon_generation",
      target_count: targetCount,
    }));
    notifyAppContextChange();
  }, [hasTargets, targetCount, t]);

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
      setHistoryError(describeWorkbenchError(err, "iconWorkbench.errors.historyLoad", t));
    } finally {
      setHistoryLoading(false);
    }
  }, [iconApi, t]);

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
      showNotice(t("iconWorkbench.notices.historyOpened"));
    } catch (err) {
      setHistoryError(describeWorkbenchError(err, "iconWorkbench.errors.historyOpen", t));
    } finally {
      setOpeningHistorySessionId(null);
    }
  }, [applySession, iconApi, showNotice, t]);

  const handleDeleteHistorySession = useCallback(async (sessionId: string) => {
    setDeletingHistorySessionId(sessionId);
    setHistoryError(null);
    try {
      await iconApi.deleteSession(sessionId);
      setHistoryItems((current) => current.filter((item) => item.session_id !== sessionId));
      if (session?.session_id === sessionId) {
        clearCurrentSession();
        showNotice(t("iconWorkbench.notices.historyDeletedCurrent"));
      } else {
        showNotice(t("iconWorkbench.notices.historyDeleted"));
      }
      return true;
    } catch (err) {
      setHistoryError(describeWorkbenchError(err, "iconWorkbench.errors.historyDelete", t));
      return false;
    } finally {
      setDeletingHistorySessionId(null);
    }
  }, [clearCurrentSession, iconApi, session?.session_id, showNotice, t]);

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
    disconnectNoticeShownRef.current = false;
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
          showNotice(tRef.current("iconWorkbench.notices.workspaceRestored"));
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
    disconnectNoticeShownRef.current = false;
    scheduleOfflineState();
    streamRef.current = createIconWorkbenchEventStream({
      baseUrl,
      sessionId: session.session_id,
      accessToken: apiToken,
      onEvent: handleWorkbenchEvent,
      onError: () => {
        setStreamStatus("reconnecting");
        if (!disconnectNoticeShownRef.current) {
          disconnectNoticeShownRef.current = true;
          showNotice(tRef.current("iconWorkbench.notices.streamDisconnected"));
        }
        scheduleOfflineState();
      },
    });
    return closeEventStream;
  }, [apiToken, baseUrl, closeEventStream, handleWorkbenchEvent, scheduleOfflineState, session?.session_id, showNotice]);

  const generationConfigBlockedReason: IconGenerationBlockedReason | null = !isTextModelConfigured
    ? "text_model_unconfigured"
    : !isImageModelConfigured
      ? "image_model_unconfigured"
      : null;
  const generateBlockedReason: IconGenerationBlockedReason | null = !hasTargets
    ? "no_targets"
    : !hasSelectedStyle
      ? "no_selected_style"
      : generationConfigBlockedReason || (isBusy ? "busy" : null);

  const appendTargetPaths = useCallback(async (nextTargetPaths: string[]) => {
    if (nextTargetPaths.length === 0) return;
    setError(null);
    setActionState(session ? "adding_targets" : "creating_session");
    try {
      const nextSession = session ? await iconApi.updateTargets(session.session_id, { target_paths: nextTargetPaths, mode: "append" }) : await iconApi.createSession(nextTargetPaths);
      applySession(nextSession);
    } catch (err) {
      setError(describeWorkbenchError(err, "iconWorkbench.errors.loadTargets", t));
    } finally { setActionState(null); }
  }, [applySession, iconApi, session, t]);

  const handleChooseTargets = useCallback(async () => {
    setError(null);
    try {
      const selectedPaths = desktopReady ? await pickDirectoriesWithTauri() : null;
      const selectedPath = desktopReady ? null : (await systemApi.selectDir()).path;
      const paths = selectedPaths ?? (selectedPath ? [selectedPath] : []);
      if (paths?.length) await appendTargetPaths(paths);
    } catch (err) { setError(describeWorkbenchError(err, "iconWorkbench.errors.chooseTargets", t)); }
  }, [appendTargetPaths, desktopReady, systemApi, t]);

  const handleTargetDrop = useCallback(async (event: React.DragEvent) => {
    event.preventDefault(); setIsTargetDropActive(false);
    const files = Array.from(event.dataTransfer.files);
    const paths = files
      .map((file) => (file as File & { path?: string }).path)
      .filter((path): path is string => Boolean(path));
    if (files.length > 0 && paths.length === 0) {
      if (!desktopReady) {
        showNotice(t("iconWorkbench.notices.webDropUnsupported"));
      }
      return;
    }
    if (paths.length) await appendTargetPaths(paths);
  }, [appendTargetPaths, desktopReady, showNotice, t]);

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
    setActionState("resetting");
    setError(null);
    try {
      applySession(await iconApi.updateTargets(session.session_id, { target_paths: [], mode: "replace" }));
      setResetConfirmOpen(false);
    } catch (err) {
      setError(describeWorkbenchError(err, "iconWorkbench.errors.resetWorkbench", t));
    } finally {
      setActionState(null);
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
      if (failedFolders.length > 0) {
        setError(t("iconWorkbench.errors.generateFolderFailures", {
          folders: failedFolders.map((folder) => `“${folder.folder_name}”`).join(", "),
        }));
      }
      showNotice(t("iconWorkbench.notices.generated", { success: successCount, failed: failedCount, skipped: skippedCount }));
    } catch (err) { setError(describeWorkbenchError(err, "iconWorkbench.errors.generate", t)); } finally { setGenerateProgress(null); }
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
      showNotice(successMessage, t("iconWorkbench.notices.actionLoggedAfterResync"), actionPath ?? null);
      return syncedSession;
    } catch (err) {
      const detail = describeWorkbenchError(err, "iconWorkbench.errors.sync", t);
      setError(t("iconWorkbench.errors.failureWithDetail", { message: failureMessage, detail }));
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
        showNotice(t("iconWorkbench.notices.versionApplied", { folderName: folder.folder_name }), null, folder.folder_path);
      } catch {
        const syncedSession = await iconApi.scanSession(session.session_id);
        applySession(syncedSession);
        showNotice(t("iconWorkbench.notices.versionAppliedResynced", { folderName: folder.folder_name }), null, folder.folder_path);
      }
    } catch (err) { setError(describeWorkbenchError(err, "iconWorkbench.errors.apply", t)); } finally { setActiveProcessingId(null); setIsApplyingId(null); }
  };

  const handleRemoveTarget = async (folderId: string) => {
    if (!session) return;
    setActionState("removing_target");
    try {
      applySession(await iconApi.removeTarget(session.session_id, folderId));
    } catch (err) { setError(describeWorkbenchError(err, "iconWorkbench.errors.removeTarget", t)); } finally { setActionState(null); }
  };

  const handleDeleteVersion = async (folderId: string, versionId: string) => {
    if (!session) return;
    setActionState("deleting_version");
    try {
      applySession(await iconApi.deleteVersion(session.session_id, folderId, versionId));
      showNotice(t("iconWorkbench.notices.versionDeleted"));
    } catch (err) { setError(describeWorkbenchError(err, "iconWorkbench.errors.deleteVersion", t)); } finally { setActionState(null); }
  };

  const handleSelectVersion = async (folderId: string, versionId: string) => {
    if (!session) return;
    setActionState("switching_version");
    setError(null);
    try {
      applySession(await iconApi.selectVersion(session.session_id, folderId, versionId));
    } catch (err) {
      setError(describeWorkbenchError(err, "iconWorkbench.errors.selectVersion", t));
    } finally {
      setActionState(null);
    }
  };

  const handleRestoreIcon = async (folder: FolderIconCandidate) => {
    if (!desktopReady) return;
    setActionState("restoring_icon");
    setError(null);
    try {
      await invokeTauriCommand("restore_last_folder_icon", { folderPath: folder.folder_path });
      const nextSession = await reportClientAction("restore_icons", [{ folder_id: folder.folder_id, status: "restored", message: t("iconWorkbench.notices.folderRestored", { folderName: folder.folder_name }) }]);
      if (nextSession) {
        applySession(nextSession);
        showNotice(t("iconWorkbench.notices.folderRestored", { folderName: folder.folder_name }));
      } else if (session) {
        await syncAfterClientActionReportFailure(
          t("iconWorkbench.notices.folderRestoredResynced", { folderName: folder.folder_name }),
          t("iconWorkbench.errors.restoreSyncFailed"),
          folder.folder_path,
        );
      }
    } catch (err) {
      setError(describeWorkbenchError(err, "iconWorkbench.errors.restore", t));
    } finally {
      setActionState(null);
    }
  };

  const handleApplyBatch = async () => {
    if (!session) return;
    if (!desktopReady) {
      setError(t("iconWorkbench.errors.batchApplyDesktopOnly"));
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
        const summary = nextSession.last_client_action?.summary;
        showNotice(t("iconWorkbench.notices.batchAppliedSummary", {
          success: summary?.success_count ?? results.filter((result) => result.status === "applied").length,
          failed: summary?.failed_count ?? results.filter((result) => result.status === "failed").length,
          skipped: summary?.skipped_count ?? prep.skipped_items.length,
        }), null, appliedFolderPath ?? null);
      } else {
        const appliedFolderPath = results.find((result) => result.status === "applied" && result.folder_path)?.folder_path;
        await syncAfterClientActionReportFailure(
          t("iconWorkbench.notices.batchAppliedResynced"),
          t("iconWorkbench.errors.applySyncFailed"),
          appliedFolderPath ?? null,
        );
      }
    } catch (err) {
      setError(describeWorkbenchError(err, "iconWorkbench.errors.batchApply", t));
    } finally {
      setBatchApplyLoading(false);
    }
  };

  const retryEventStream = useCallback(async () => {
    if (!session?.session_id) return;
    closeEventStream();
    setStreamStatus("connecting");
    streamRef.current = createIconWorkbenchEventStream({ baseUrl, sessionId: session.session_id, accessToken: apiToken, onEvent: handleWorkbenchEvent, onError: () => setStreamStatus("reconnecting") });
    iconApi.getSession(session.session_id).then(applySession).catch(() => setError(t("iconWorkbench.errors.reconnect")));
  }, [apiToken, applySession, baseUrl, closeEventStream, handleWorkbenchEvent, iconApi, session?.session_id, t]);

  const shouldShowNotice = Boolean(notice?.message);
  
  const statusRail = (error || shouldShowNotice || generationConfigBlockedReason || (streamStatus !== "connected" && session)) ? (
    <div className="flex flex-col">
      {error ? (
        <div className="flex h-8 items-center justify-between gap-4 border-b bg-error/5 px-5 text-error">
          <div className="flex min-w-0 items-center gap-2">
            <AlertCircle className="h-3 w-3 shrink-0" />
            <p className="truncate text-[11px] font-bold" title={error}>{error}</p>
          </div>
          <button onClick={() => setError(null)} className="shrink-0 text-error/50 hover:text-error" title={t("iconWorkbench.common.closeError")}><X className="h-3 w-3" /></button>
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
            <p className="text-[11px] font-medium text-on-surface/40 uppercase tracking-tight">{t(`iconWorkbench.status.${streamStatus === "connecting" ? "connecting" : streamStatus === "reconnecting" ? "reconnecting" : "offline"}`)}</p>
          </div>
          <button onClick={retryEventStream} className="text-[11px] font-black uppercase tracking-widest text-primary/60">{t("iconWorkbench.status.reconnect")}</button>
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
              className="flex h-5 shrink-0 items-center gap-1 rounded bg-primary/10 px-2 text-[11px] font-black uppercase text-primary hover:bg-primary/20"
            >
              <FolderOpen className="h-3 w-3" />
              {t("iconWorkbench.common.openToView")}
            </button>
          ) : null}
          <button onClick={() => showNotice(null)} className="text-ui-muted/30 hover:text-on-surface" title={t("iconWorkbench.common.dismissNotice")}><X className="h-3 w-3" /></button>
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
            <span className="text-[11px] font-black uppercase tracking-widest text-primary/40 shrink-0">{t("iconWorkbench.progress.generatingNow")}</span>
            <p className="truncate text-[12px] font-black text-on-surface/80">{generatePresentation.title}</p>
            <span className="text-[11px] font-medium text-ui-muted/40 truncate shrink-0">{generatePresentation.detail}</span>
            {generatePresentation.steps.map((step) => (
              <span key={step.key} className="text-[11px] font-bold text-ui-muted/35">
                {step.label}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-bold tabular-nums text-primary/60">{generatePresentation.counter}</span>
          <div className="h-1 w-16 overflow-hidden rounded-full bg-primary/10">
            <div className="h-full bg-primary transition-all duration-700 ease-out" style={{ width: `${generatePresentation.percent}%` }} />
          </div>
        </div>
      </div>
    </div>
  ) : actionState ? (
    <div className="flex h-7 items-center gap-2 bg-primary/[0.04] border-b border-primary/8 px-5">
      <LoaderCircle className="h-2.5 w-2.5 animate-spin text-primary" />
      <span className="text-[11px] font-black uppercase tracking-[0.2em] text-primary/70">{t(ICON_ACTION_LABELS[actionState])}</span>
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
                <p className="text-[12px] font-bold text-on-surface/40 uppercase tracking-widest">{t("iconWorkbench.status.restoring")}</p>
              </div>
            </motion.div>
          ) : (
            <motion.div key="main" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-1 flex-col overflow-hidden">
              <IconWorkbenchToolbar targetCount={targetCount} latestTargetPath={latestTargetPath} onAddTargets={handleChooseTargets} onClearTargets={() => setResetConfirmOpen(true)} onOpenHistory={handleOpenHistoryDrawer} onOpenStylePanel={() => setStylePanelOpen(true)} onOpenTemplateDrawer={() => setTemplateDrawerOpen(true)} selectedTemplateName={selectedTemplateDisplayName} hasSelectedStyle={Boolean(selectedTemplate)} />
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
                  generateStage={generateProgress?.stage ?? null}
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
                selectedTemplateName={selectedTemplateDisplayName || null}
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
        <IconWorkbenchPreviewModal src={buildImageSrc(previewVersion, baseUrl, apiToken)} title={`v${previewVersion.version_number}`} subtitle={selectedTemplateDisplayName || t("iconWorkbench.preview.version")} localImagePath={previewVersion.image_path} folderName={previewFolder?.folder_name || t("iconWorkbench.preview.defaultFolderName")} folderPath={previewFolder?.folder_path || ""} onOpenFolder={openDirectoryWithTauri} onClose={() => setPreviewVersion(null)} onApply={() => previewFolder && handleApplyVersion(previewFolder.folder_id, previewVersion)} onRegenerate={() => previewFolder && runGenerateFlow([previewFolder.folder_id])} regenerateDisabled={!!generationConfigBlockedReason || isBusy || !previewFolder} isApplying={isApplyingId === previewVersion.version_id} imageModelName={workbenchConfig?.image_model.model || t("iconWorkbench.common.defaultModel")} isApplied={previewFolder?.applied_version_id === previewVersion.version_id} isCurrentVersion={previewFolder?.current_version_id === previewVersion.version_id} />
      )}

      <ConfirmDialog open={restoreConfirmOpen} title={t("iconWorkbench.confirm.restoreTitle")} description={t("iconWorkbench.confirm.restoreDescription", { folderName: folderToRestore?.folder_name ?? "" })} loading={actionState === "restoring_icon"} onClose={() => setRestoreConfirmOpen(false)} onConfirm={async () => { if (folderToRestore) await handleRestoreIcon(folderToRestore); setRestoreConfirmOpen(false); }} />
      <ConfirmDialog open={resetConfirmOpen} title={t("iconWorkbench.confirm.resetTitle")} description={t("iconWorkbench.confirm.resetDescription")} loading={actionState === "resetting"} onClose={() => setResetConfirmOpen(false)} onConfirm={handleResetWorkbench} />
      <ConfirmDialog
        open={Boolean(pendingDeleteHistorySessionId)}
        title={t("iconWorkbench.confirm.deleteHistoryTitle")}
        description={pendingDeleteHistorySessionId === session?.session_id
          ? t("iconWorkbench.confirm.deleteCurrentHistory")
          : t("iconWorkbench.confirm.deleteHistoryDescription", {
              targetPath: pendingDeleteHistorySession?.target_paths?.[0] || t("iconWorkbench.confirm.emptyHistoryTarget"),
            })}
        confirmLabel={t("iconWorkbench.confirm.delete")}
        cancelLabel={t("iconWorkbench.confirm.cancel")}
        tone="danger"
        loading={Boolean(deletingHistorySessionId)}
        onConfirm={confirmDeleteHistorySession}
        onCancel={() => setPendingDeleteHistorySessionId(null)}
      />
    </div>
  );
}
