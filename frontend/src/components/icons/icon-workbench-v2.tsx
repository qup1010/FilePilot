"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen, FolderPlus, LoaderCircle, Palette, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorAlert } from "@/components/ui/error-alert";
import { createApiClient } from "@/lib/api";
import { createIconWorkbenchApiClient } from "@/lib/icon-workbench-api";
import { getApiBaseUrl, getApiToken, invokeTauriCommand, isTauriDesktop, pickDirectoriesWithTauri } from "@/lib/runtime";
import { cn } from "@/lib/utils";
import type {
  ApplyIconResult,
  FolderIconCandidate,
  IconPreviewVersion,
  IconWorkbenchPendingAction,
  IconWorkbenchSession,
} from "@/types/icon-workbench";
import { IconWorkbenchFooterBar } from "./icon-workbench-footer-bar";
import { IconWorkbenchFolderList } from "./icon-workbench-folder-list";
import { IconWorkbenchPreviewModal } from "./icon-workbench-preview-modal";
import { IconWorkbenchStylePanel } from "./icon-workbench-style-panel";
import { IconWorkbenchTemplateDrawer } from "./icon-workbench-template-drawer";
import { IconWorkbenchToolbar } from "./icon-workbench-toolbar";
import { buildImageSrc, isFolderReady } from "./icon-workbench-utils";
import { useBackgroundRemoval } from "./use-background-removal";
import { useIconTemplates } from "./use-icon-templates";

const APP_CONTEXT_EVENT = "file-organizer-context-change";
const ICONS_CONTEXT_KEY = "icons_header_context";
const ICONS_WORKSPACE_STATE_KEY = "icons_workspace_state";

interface PersistedIconsWorkspaceState {
  sessionId: string;
  selectedTemplateId: string;
  expandedFolderId: string | null;
}

type GuideActionKind = "target" | "style" | "generate";
function IconWorkbenchGuideBar({
  statusText,
  primaryCtaLabel,
  primaryActionKind,
  primaryCtaDisabled,
  onPrimaryAction,
}: {
  statusText: string;
  primaryCtaLabel: string;
  primaryActionKind: GuideActionKind;
  primaryCtaDisabled: boolean;
  onPrimaryAction: () => void;
}) {
  const ActionIcon = primaryActionKind === "style" ? Palette : primaryActionKind === "generate" ? Sparkles : FolderPlus;

  return (
    <div className="border-b border-on-surface/6 bg-surface-container-low/55 px-6 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-[13px] font-semibold leading-6 text-on-surface">{statusText}</p>
        <Button
          variant="primary"
          size="md"
          onClick={onPrimaryAction}
          disabled={primaryCtaDisabled}
          className="shrink-0 px-5"
        >
          <ActionIcon className="h-4.5 w-4.5" />
          {primaryCtaLabel}
        </Button>
      </div>
    </div>
  );
}

export default function IconWorkbenchV2() {
  const baseUrl = getApiBaseUrl();
  const apiToken = getApiToken();
  const desktopReady = isTauriDesktop();
  const iconApi = useMemo(() => createIconWorkbenchApiClient(baseUrl, apiToken), [apiToken, baseUrl]);
  const systemApi = useMemo(() => createApiClient(baseUrl, apiToken), [apiToken, baseUrl]);

  const [session, setSession] = useState<IconWorkbenchSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionLabel, setActionLabel] = useState<string | null>(null);

  const [expandedFolderId, setExpandedFolderId] = useState<string | null>(null);
  const [stylePanelOpen, setStylePanelOpen] = useState(false);
  const [templateDrawerOpen, setTemplateDrawerOpen] = useState(false);
  const [previewVersion, setPreviewVersion] = useState<IconPreviewVersion | null>(null);

  const [activeProcessingId, setActiveProcessingId] = useState<string | null>(null);
  const [isApplyingId, setIsApplyingId] = useState<string | null>(null);
  const [batchApplyLoading, setBatchApplyLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [folderToRestore, setFolderToRestore] = useState<FolderIconCandidate | null>(null);
  const [restoringSession, setRestoringSession] = useState(true);
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
  } = useIconTemplates({ iconApi, setError, setNotice });
  const {
    bgApiToken,
    handleBgApiTokenChange,
    processingBgVersionIds,
    isRemovingBgBatch,
    handleRemoveBg,
    handleRemoveBgBatch,
  } = useBackgroundRemoval({
    desktopReady,
    session,
    setSession,
    setError,
    setNotice,
  });

  const targetCount = session?.folders.length ?? 0;
  const hasTargets = targetCount > 0;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const detail = hasTargets ? `已选 ${targetCount} 个目标文件夹` : "选择目标文件夹并开始生成";
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

  const applySession = useCallback((nextSession: IconWorkbenchSession) => {
    setSession(nextSession);
    setExpandedFolderId((current) => (
      current && nextSession.folders.some((folder) => folder.folder_id === current) ? current : null
    ));
    setPreviewVersion((current) => {
      if (!current) return current;
      const stillExists = nextSession.folders.some((folder) => folder.versions.some((version) => version.version_id === current.version_id));
      return stillExists ? current : null;
    });
    setFolderToRestore((current) => {
      if (!current) return current;
      return nextSession.folders.find((folder) => folder.folder_id === current.folder_id) || null;
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const raw = window.localStorage.getItem(ICONS_WORKSPACE_STATE_KEY);
    if (!raw) {
      setRestoringSession(false);
      return;
    }

    let parsed: PersistedIconsWorkspaceState | null = null;
    try {
      parsed = JSON.parse(raw) as PersistedIconsWorkspaceState;
    } catch {
      window.localStorage.removeItem(ICONS_WORKSPACE_STATE_KEY);
      setRestoringSession(false);
      return;
    }

    if (!parsed?.sessionId) {
      window.localStorage.removeItem(ICONS_WORKSPACE_STATE_KEY);
      setRestoringSession(false);
      return;
    }

    if (parsed.selectedTemplateId) {
      setSelectedTemplateId(parsed.selectedTemplateId);
    }
    setExpandedFolderId(parsed.expandedFolderId || null);

    let cancelled = false;
    iconApi.getSession(parsed.sessionId)
      .then((nextSession) => {
        if (!cancelled) {
          applySession(nextSession);
        }
      })
      .catch(() => {
        if (!cancelled) {
          window.localStorage.removeItem(ICONS_WORKSPACE_STATE_KEY);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setRestoringSession(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [applySession, iconApi, setSelectedTemplateId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!session) {
      window.localStorage.removeItem(ICONS_WORKSPACE_STATE_KEY);
      return;
    }
    const payload: PersistedIconsWorkspaceState = {
      sessionId: session.session_id,
      selectedTemplateId,
      expandedFolderId,
    };
    window.localStorage.setItem(ICONS_WORKSPACE_STATE_KEY, JSON.stringify(payload));
  }, [expandedFolderId, selectedTemplateId, session]);

  const topStatusText = useMemo(() => {
    if (!hasTargets) {
      return "先选择一个或多个目标文件夹";
    }
    if (!hasSelectedStyle) {
      return `已选择 ${targetCount} 个目标文件夹，下一步请选择风格`;
    }
    return `已准备完成，将为 ${targetCount} 个目标文件夹按「${selectedTemplate?.name || "当前风格"}」风格生成图标`;
  }, [hasSelectedStyle, hasTargets, selectedTemplate?.name, targetCount]);

  const primaryCtaLabel = !hasTargets ? "选择目标文件夹" : !hasSelectedStyle ? "选择风格" : `开始生成 ${targetCount} 个图标`;
  const primaryActionKind: GuideActionKind = !hasTargets ? "target" : !hasSelectedStyle ? "style" : "generate";
  const generateBlockedReason = !hasTargets
    ? "先选择目标文件夹"
    : !hasSelectedStyle
      ? "先选择一个风格模板"
      : actionLabel
        ? "正在生成，请稍候"
        : null;

  const handleChooseTargets = useCallback(async () => {
    setError(null);
    try {
      let nextTargetPaths: string[] = [];
      if (desktopReady) {
        nextTargetPaths = (await pickDirectoriesWithTauri()) || [];
      } else {
        const selectedDir = (await systemApi.selectDir()).path;
        if (selectedDir) {
          nextTargetPaths = [selectedDir];
        }
      }
      if (nextTargetPaths.length === 0) return;

      setActionLabel(session ? "正在添加目标文件夹..." : "正在创建目标集合...");
      const nextSession = session
        ? await iconApi.updateTargets(session.session_id, { target_paths: nextTargetPaths, mode: "append" })
        : await iconApi.createSession(nextTargetPaths);
      applySession(nextSession);
      setNotice(session
        ? `已追加 ${nextTargetPaths.length} 个目标文件夹，当前共 ${nextSession.folder_count} 个。`
        : `已选择 ${nextSession.folder_count} 个目标文件夹。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "选择目标文件夹失败");
    } finally {
      setActionLabel(null);
    }
  }, [applySession, desktopReady, iconApi, session, systemApi]);

  const runGenerateFlow = async (folderIds: string[]) => {
    if (!session || folderIds.length === 0) return;
    if (!selectedTemplateId) {
      setError("请先选择一个风格模板。");
      return;
    }

    setActionLabel(`正在为 ${folderIds.length} 个目标文件夹生成图标...`);
    try {
      applySession(await iconApi.analyzeFolders(session.session_id, folderIds));
      applySession(await iconApi.applyTemplate(session.session_id, selectedTemplateId, folderIds));
      applySession(await iconApi.generatePreviews(session.session_id, folderIds));
      setNotice(`已完成 ${folderIds.length} 个目标文件夹的图标生成。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成图标失败");
    } finally {
      setActionLabel(null);
    }
  };

  const reportClientAction = async (type: string, results: ApplyIconResult[]) => {
    if (!session) return;
    try {
      await iconApi.reportClientAction(session.session_id, {
        action_type: type,
        results,
        skipped_items: [],
      });
    } catch (reportError) {
      console.error("Report client action failed", reportError);
    }
  };

  const handleApplyVersion = async (folderId: string, version: IconPreviewVersion) => {
    if (!session || version.status !== "ready" || !desktopReady) return;

    setActiveProcessingId(folderId);
    setIsApplyingId(version.version_id);
    try {
      const folder = session.folders.find((item) => item.folder_id === folderId);
      if (!folder) return;

      const result = await invokeTauriCommand<string>("apply_folder_icon", {
        folderPath: folder.folder_path,
        imagePath: version.image_path,
      });

      const report: ApplyIconResult[] = [{
        folder_id: folderId,
        folder_name: folder.folder_name,
        folder_path: folder.folder_path,
        status: "applied",
        message: result || "应用成功",
      }];

      await reportClientAction("apply_icons", report);
      applySession(await iconApi.selectVersion(session.session_id, folderId, version.version_id));
      setNotice(`「${folder.folder_name}」图标已应用。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "应用图标失败");
    } finally {
      setActiveProcessingId(null);
      setIsApplyingId(null);
    }
  };

  const handleApplyBatch = async () => {
    if (!session || allFolderIds.length === 0 || !desktopReady) return;

    setBatchApplyLoading(true);
    try {
      const preparation = await iconApi.prepareApplyReady(session.session_id, allFolderIds);
      if (preparation.tasks.length === 0) {
        setNotice("没有可直接应用的就绪版本。");
        return;
      }

      const results = await invokeTauriCommand<ApplyIconResult[]>("apply_ready_icons", {
        tasks: preparation.tasks,
      });

      const appliedResults = results || [];
      await reportClientAction("apply_icons", appliedResults);
      applySession(await iconApi.scanSession(session.session_id));
      setNotice(`成功应用 ${appliedResults.filter((item) => item.status === "applied").length} 个目标文件夹图标。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量应用失败");
    } finally {
      setBatchApplyLoading(false);
    }
  };

  const handleDeleteVersion = async (folderId: string, versionId: string) => {
    setSession(current => {
      if (!current) return current;
      const updatedFolders = current.folders.map(folder => {
        if (folder.folder_id === folderId) {
          let updatedCurrentVersion = folder.current_version_id;
          if (updatedCurrentVersion === versionId) {
            updatedCurrentVersion = null;
          }
          return {
            ...folder,
            current_version_id: updatedCurrentVersion,
            versions: folder.versions.filter(v => v.version_id !== versionId)
          };
        }
        return folder;
      });
      return { ...current, folders: updatedFolders };
    });
    setNotice("已废弃不满意的图标版本。");
  };

  const handleResetSession = useCallback(async () => {
    if (!session) return;
    setActionLabel("正在重置图标工坊...");
    try {
      const nextSession = await iconApi.updateTargets(session.session_id, { target_paths: [], mode: "replace" });
      applySession(nextSession);
      setSelectedTemplateId("");
      setResetConfirmOpen(false);
      setNotice("已清空所有目标文件夹。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "重置失败");
    } finally {
      setActionLabel(null);
    }
  }, [applySession, iconApi, session]);

  const handleRemoveTarget = async (folderId: string) => {
    if (!session) return;
    const folder = session.folders.find((item) => item.folder_id === folderId);
    if (!folder) return;

    setActionLabel("正在移除目标文件夹...");
    try {
      const nextSession = await iconApi.removeTarget(session.session_id, folderId);
      applySession(nextSession);
      if (folderToRestore?.folder_id === folderId) {
        setRestoreConfirmOpen(false);
      }
      setNotice(`已将「${folder.folder_name}」移出本次目标。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "移除目标文件夹失败");
    } finally {
      setActionLabel(null);
    }
  };

  const handleRestoreIcon = async () => {
    if (!folderToRestore || !desktopReady) return;

    try {
      await invokeTauriCommand("clear_folder_icon", { folderPath: folderToRestore.folder_path });
      setNotice(`「${folderToRestore.folder_name}」已还原为默认图标。`);
      setRestoreConfirmOpen(false);
    } catch {
      setError("还原图标失败");
    }
  };

  const handleConfirmAction = async (action: IconWorkbenchPendingAction) => {
    if (!session) return;
    setActionLoadingId(action.action_id);
    try {
      const response = await iconApi.confirmAction(session.session_id, action.action_id);
      applySession(response.session);
    } catch {
      setError("执行待办动作失败");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDismissAction = async (action: IconWorkbenchPendingAction) => {
    if (!session) return;
    setActionLoadingId(action.action_id);
    try {
      applySession(await iconApi.dismissAction(session.session_id, action.action_id));
    } catch {
      setError("取消待办动作失败");
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleGuidePrimaryAction = () => {
    if (!hasTargets) {
      void handleChooseTargets();
      return;
    }
    if (!hasSelectedStyle) {
      setStylePanelOpen(true);
      return;
    }
    void runGenerateFlow(allFolderIds);
  };

  const shouldShowNotice = useMemo(() => {
    if (!notice) return false;
    return !(
      notice.includes("已选择 ") ||
      notice.includes("已追加 ") ||
      notice.includes("已将「") && notice.includes("移出本次目标")
    );
  }, [notice]);

  const statusRail = (error || shouldShowNotice || (session?.pending_actions?.length ?? 0) > 0) ? (
    <div className="space-y-3 border-b border-on-surface/6 bg-white/36 px-6 py-3 backdrop-blur-sm">
      {error ? <ErrorAlert message={error} onClose={() => setError(null)} /> : null}
      {shouldShowNotice ? (
        <div className="flex items-center gap-3 rounded-2xl border border-primary/10 bg-primary/4 px-4 py-3 text-[13px] text-primary">
          <p className="flex-1 font-bold">{notice}</p>
          <button onClick={() => setNotice(null)} className="opacity-60 hover:opacity-100">关闭</button>
        </div>
      ) : null}
      {session?.pending_actions?.map((action) => (
        <div key={action.action_id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-warning/20 bg-warning/6 p-4">
          <div className="max-w-[400px]">
            <p className="text-[14px] font-black text-on-surface">{action.title}</p>
            <p className="mt-1 text-[12px] text-ui-muted">{action.description}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => handleConfirmAction(action)} loading={actionLoadingId === action.action_id}>确认执行</Button>
            <Button variant="secondary" size="sm" onClick={() => handleDismissAction(action)} disabled={actionLoadingId === action.action_id}>取消</Button>
          </div>
        </div>
      ))}
    </div>
  ) : null;

  const processingBanner = actionLabel ? (
    <div className="flex items-center gap-3 bg-primary/10 px-6 py-2 text-[12px] font-bold text-primary">
      <LoaderCircle className="h-3 w-3 animate-spin" />
      <span>{actionLabel}</span>
    </div>
  ) : null;

  const renderEmptyState = (title: string, description: string) => (
    <div className="flex-1 px-6 py-5">
      <EmptyState icon={FolderOpen} title={title} description={description}>
        <Button size="lg" onClick={handleChooseTargets} className="px-7">
          <FolderPlus className="mr-2 h-5 w-5" />
          {session ? "添加目标文件夹" : "选择目标文件夹"}
        </Button>
      </EmptyState>
    </div>
  );

  if (!templatesInitialized && templatesLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-4">
          <LoaderCircle className="h-10 w-10 animate-spin text-primary/40" />
          <p className="text-[14px] font-bold text-on-surface">初始化图标工坊...</p>
        </div>
      </div>
    );
  }

  if (restoringSession) {
    return (
      <div className="flex flex-1 items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-4">
          <LoaderCircle className="h-10 w-10 animate-spin text-primary/40" />
          <p className="text-[14px] font-bold text-on-surface">正在恢复图标工坊状态...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden bg-surface">
      <IconWorkbenchToolbar
        targetCount={targetCount}
        latestTargetPath={latestTargetPath}
        onAddTargets={handleChooseTargets}
        onClearTargets={() => setResetConfirmOpen(true)}
        onOpenStylePanel={() => setStylePanelOpen(true)}
        onOpenTemplateDrawer={() => setTemplateDrawerOpen(true)}
        selectedTemplateName={selectedTemplate?.name || "请先选择风格"}
      />

      <IconWorkbenchGuideBar
        statusText={topStatusText}
        primaryCtaLabel={primaryCtaLabel}
        primaryActionKind={primaryActionKind}
        primaryCtaDisabled={Boolean(actionLabel)}
        onPrimaryAction={handleGuidePrimaryAction}
      />

      {statusRail}
      {processingBanner}

      {!hasTargets ? (
        renderEmptyState(
          session ? "当前还没有目标文件夹" : "先选择一个或多个要美化图标的文件夹",
          "选择目标后，再挑一个风格，就可以为这些文件夹生成图标版本。",
        )
      ) : (
        <IconWorkbenchFolderList
          folders={session?.folders || []}
          expandedFolderId={expandedFolderId}
          onToggleExpand={setExpandedFolderId}
          onSelectVersion={async (folderId, versionId) => {
            if (!session) return;
            applySession(await iconApi.selectVersion(session.session_id, folderId, versionId));
          }}
          onZoom={setPreviewVersion}
          onApplyVersion={handleApplyVersion}
          onRegenerate={(folderId) => void runGenerateFlow([folderId])}
          onRestore={(folderId) => {
            const folder = session?.folders.find((item) => item.folder_id === folderId);
            if (folder) {
              setFolderToRestore(folder);
              setRestoreConfirmOpen(true);
            }
          }}
        onRemoveTarget={(folderId) => void handleRemoveTarget(folderId)}
        onRemoveBg={(folderId, version) => void handleRemoveBg(folderId, version)}
        onDeleteVersion={(folderId, versionId) => void handleDeleteVersion(folderId, versionId)}
        processingBgVersionIds={processingBgVersionIds}
        baseUrl={baseUrl}
        apiToken={apiToken}
          isApplyingId={isApplyingId}
        activeProcessingId={activeProcessingId}
        desktopReady={desktopReady}
        hasSelectedStyle={hasSelectedStyle}
      />
      )}

      {hasTargets && hasSelectedStyle ? (
        <IconWorkbenchFooterBar
          targetCount={targetCount}
          isGenerating={Boolean(actionLabel)}
          isApplying={batchApplyLoading}
          onGenerate={() => void runGenerateFlow(allFolderIds)}
          onApplyBatch={handleApplyBatch}
          canApplyBatch={canApplyBatch}
          onRemoveBgBatch={handleRemoveBgBatch}
          canRemoveBgBatch={canApplyBatch}
          isRemovingBgBatch={isRemovingBgBatch}
          selectedTemplateName={selectedTemplate?.name || null}
          generateBlockedReason={generateBlockedReason}
        />
      ) : null}

      <IconWorkbenchStylePanel
        isOpen={stylePanelOpen}
        onClose={() => setStylePanelOpen(false)}
        templates={templates}
        selectedTemplateId={selectedTemplateId}
        onSelect={setSelectedTemplateId}
        onRequestManageTemplate={(templateId) => {
          setSelectedTemplateId(templateId);
          setStylePanelOpen(false);
          setTemplateDrawerOpen(true);
        }}
        bgApiToken={bgApiToken}
        onBgApiTokenChange={handleBgApiTokenChange}
      />

      <IconWorkbenchTemplateDrawer
        open={templateDrawerOpen}
        templates={templates}
        templatesLoading={templatesLoading}
        selectedTemplate={selectedTemplate}
        templateNameDraft={templateNameDraft}
        templateDescriptionDraft={templateDescriptionDraft}
        templatePromptDraft={templatePromptDraft}
        templateActionLoading={templateActionLoading}
        onClose={() => setTemplateDrawerOpen(false)}
        onSelectTemplate={setSelectedTemplateId}
        onTemplateNameChange={setTemplateNameDraft}
        onTemplateDescriptionChange={setTemplateDescriptionDraft}
        onTemplatePromptChange={setTemplatePromptDraft}
        onReloadTemplates={() => void reloadTemplates(selectedTemplateId)}
        onCreateTemplate={() => void createTemplate()}
        onUpdateTemplate={() => void updateTemplate()}
        onDeleteTemplate={() => void deleteTemplate()}
      />

      {previewVersion ? (
        <IconWorkbenchPreviewModal
          src={buildImageSrc(previewVersion, baseUrl, apiToken)}
          title={`版本预览 - v${previewVersion.version_number}`}
          subtitle={selectedTemplate?.name || "预览"}
          onClose={() => setPreviewVersion(null)}
        />
      ) : null}

      <ConfirmDialog
        open={restoreConfirmOpen}
        onClose={() => setRestoreConfirmOpen(false)}
        title="还原默认图标"
        description={folderToRestore ? `确定要将「${folderToRestore.folder_name}」还原为默认系统图标吗？` : "确定要还原默认图标吗？"}
        confirmLabel="还原"
        tone="danger"
        onConfirm={handleRestoreIcon}
      />

      <ConfirmDialog
        open={resetConfirmOpen}
        onClose={() => setResetConfirmOpen(false)}
        title="清空所有目标"
        description="确定要移除当前工作台中所有的目标文件夹吗？这将清空相关的预览记录。"
        confirmLabel="确认清空"
        tone="danger"
        onConfirm={handleResetSession}
      />
    </div>
  );
}
