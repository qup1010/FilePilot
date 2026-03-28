"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  BrushCleaning,
  Check,
  FolderCog,
  FolderOpen,
  ImagePlus,
  LoaderCircle,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorAlert } from "@/components/ui/error-alert";
import { createApiClient } from "@/lib/api";
import { createIconWorkbenchApiClient } from "@/lib/icon-workbench-api";
import { getApiBaseUrl, getApiToken, invokeTauriCommand, isTauriDesktop, pickDirectoryWithTauri } from "@/lib/runtime";
import { cn, formatDisplayDate } from "@/lib/utils";
import type {
  ApplyIconResult,
  ApplyReadySkippedItem,
  FolderIconCandidate,
  IconPreviewVersion,
  IconTemplate,
  IconWorkbenchClientExecution,
  IconWorkbenchPendingAction,
  IconWorkbenchSession,
} from "@/types/icon-workbench";

const APP_CONTEXT_EVENT = "file-organizer-context-change";
const ICONS_CONTEXT_KEY = "icons_header_context";

type LocalFolderOperationState = "applied" | "restored" | "cleared";
type SummaryTone = "success" | "ready" | "error" | "idle";
type BatchApplyReport = {
  total: number;
  applied: number;
  failed: number;
  skipped: number;
  results: ApplyIconResult[];
  skipped_items: ApplyReadySkippedItem[];
};

function buildImageSrc(version: IconPreviewVersion, baseUrl: string, apiToken: string) {
  const url = new URL(version.image_url.replace(/^\//, ""), `${baseUrl.replace(/\/$/, "")}/`);
  if (apiToken) {
    url.searchParams.set("access_token", apiToken);
  }
  return url.toString();
}

function isFolderReady(folder: FolderIconCandidate) {
  if (!folder.current_version_id) {
    return false;
  }
  return folder.versions.some((version) => version.version_id === folder.current_version_id && version.status === "ready");
}

function resolvePreviewVersion(folder: FolderIconCandidate): IconPreviewVersion | null {
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

function deriveFolderOperations(session: IconWorkbenchSession | null): Record<string, LocalFolderOperationState> {
  const next: Record<string, LocalFolderOperationState> = {};
  for (const message of session?.messages || []) {
    for (const result of message.tool_results) {
      const folderId = typeof result.payload.folder_id === "string" ? result.payload.folder_id : "";
      const status = typeof result.payload.status === "string" ? result.payload.status : "";
      if (!folderId || !status) {
        continue;
      }
      if (status === "applied") {
        next[folderId] = "applied";
      } else if (status === "restored") {
        next[folderId] = "restored";
      }
    }
  }
  return next;
}

function summarizeFolder(folder: FolderIconCandidate, operationState: Record<string, LocalFolderOperationState>) {
  if (operationState[folder.folder_id] === "applied") {
    return { label: "已应用", tone: "success" as SummaryTone };
  }
  if (folder.last_error || folder.analysis_status === "error" || folder.versions.some((version) => version.status === "error")) {
    return { label: "异常", tone: "error" as SummaryTone };
  }
  if (isFolderReady(folder)) {
    return { label: "已生成", tone: "success" as SummaryTone };
  }
  if (folder.analysis_status === "ready") {
    return { label: "已分析", tone: "ready" as SummaryTone };
  }
  return { label: "待处理", tone: "idle" as SummaryTone };
}

function statusClassName(tone: SummaryTone) {
  if (tone === "success") {
    return "border-primary/18 bg-primary/10 text-primary";
  }
  if (tone === "ready") {
    return "border-primary/12 bg-primary/6 text-primary/80";
  }
  if (tone === "error") {
    return "border-error/14 bg-error-container/50 text-error";
  }
  return "border-on-surface/8 bg-surface-container-low text-ui-muted";
}

function PendingActionBanner({
  action,
  busy,
  desktopReady,
  onConfirm,
  onDismiss,
}: {
  action: IconWorkbenchPendingAction;
  busy: boolean;
  desktopReady: boolean;
  onConfirm: (action: IconWorkbenchPendingAction) => void;
  onDismiss: (action: IconWorkbenchPendingAction) => void;
}) {
  const blocked = action.requires_client && !desktopReady;
  return (
    <div className="rounded-[16px] border border-warning/18 bg-[linear-gradient(180deg,rgba(244,184,78,0.12),rgba(255,255,255,0.98))] px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-warning/18 bg-warning/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-warning">
            <AlertTriangle className="h-3.5 w-3.5" />
            待确认
          </div>
          <p className="text-[14px] font-bold text-on-surface">{action.title}</p>
          <p className="text-[12px] leading-6 text-on-surface-variant">{action.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => onConfirm(action)} disabled={blocked} loading={busy}>
            确认执行
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onDismiss(action)} disabled={busy}>
            取消
          </Button>
        </div>
      </div>
      {blocked ? <p className="mt-3 text-[12px] text-error">当前为浏览器模式，这个动作需要桌面壳执行。</p> : null}
    </div>
  );
}

function StatusBar({
  actionLabel,
  notice,
  error,
  pendingActions,
  batchApplyReport,
  actionLoadingId,
  desktopReady,
  onConfirmAction,
  onDismissAction,
  onClearNotice,
  onClearBatchReport,
}: {
  actionLabel: string | null;
  notice: string | null;
  error: string | null;
  pendingActions: IconWorkbenchPendingAction[];
  batchApplyReport: BatchApplyReport | null;
  actionLoadingId: string | null;
  desktopReady: boolean;
  onConfirmAction: (action: IconWorkbenchPendingAction) => void;
  onDismissAction: (action: IconWorkbenchPendingAction) => void;
  onClearNotice: () => void;
  onClearBatchReport: () => void;
}) {
  if (!actionLabel && !notice && !error && pendingActions.length === 0 && !batchApplyReport) {
    return null;
  }
  return (
    <div className="space-y-3 border-b border-on-surface/8 bg-surface-container-lowest/92 px-4 py-3 sm:px-6">
      {error ? <ErrorAlert title="图标工坊请求失败" message={error} /> : null}
      {actionLabel ? (
        <div className="flex items-center gap-3 rounded-[14px] border border-primary/12 bg-primary/8 px-4 py-3 text-[13px] text-primary">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          <p className="font-medium">{actionLabel}</p>
        </div>
      ) : null}
      {notice ? (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 rounded-[14px] border border-primary/12 bg-primary/10 px-4 py-3 text-[13px] text-primary">
          <Check className="h-4 w-4" />
          <p className="font-medium">{notice}</p>
          <button type="button" onClick={onClearNotice} className="ml-auto text-primary/60 hover:text-primary">关闭</button>
        </motion.div>
      ) : null}
      {batchApplyReport ? (
        <div className="rounded-[14px] border border-on-surface/8 bg-white px-4 py-3 text-[12px] text-ui-muted">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>最近一次批量应用：总计 {batchApplyReport.total}，成功 {batchApplyReport.applied}，失败 {batchApplyReport.failed}，跳过 {batchApplyReport.skipped}</p>
            <button type="button" onClick={onClearBatchReport} className="font-semibold text-ui-muted hover:text-on-surface">清空</button>
          </div>
        </div>
      ) : null}
      {pendingActions.length > 0 ? (
        <div className="space-y-3">
          {pendingActions.map((action) => (
            <PendingActionBanner
              key={action.action_id}
              action={action}
              busy={actionLoadingId === action.action_id}
              desktopReady={desktopReady}
              onConfirm={onConfirmAction}
              onDismiss={onDismissAction}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TemplateDrawer({
  open,
  templates,
  templatesLoading,
  selectedTemplate,
  templateNameDraft,
  templateDescriptionDraft,
  templatePromptDraft,
  templateActionLoading,
  onClose,
  onSelectTemplate,
  onTemplateNameChange,
  onTemplateDescriptionChange,
  onTemplatePromptChange,
  onReloadTemplates,
  onCreateTemplate,
  onUpdateTemplate,
  onDeleteTemplate,
}: {
  open: boolean;
  templates: IconTemplate[];
  templatesLoading: boolean;
  selectedTemplate: IconTemplate | null;
  templateNameDraft: string;
  templateDescriptionDraft: string;
  templatePromptDraft: string;
  templateActionLoading: boolean;
  onClose: () => void;
  onSelectTemplate: (templateId: string) => void;
  onTemplateNameChange: (value: string) => void;
  onTemplateDescriptionChange: (value: string) => void;
  onTemplatePromptChange: (value: string) => void;
  onReloadTemplates: () => void;
  onCreateTemplate: () => void;
  onUpdateTemplate: () => void;
  onDeleteTemplate: () => void;
}) {
  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[80] flex justify-end bg-surface/55 backdrop-blur-sm" onClick={onClose}>
          <motion.aside
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.18 }}
            className="flex h-full w-full max-w-[560px] flex-col border-l border-on-surface/8 bg-surface-container-lowest shadow-[0_30px_90px_rgba(36,48,42,0.18)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-on-surface/8 px-5 py-4">
              <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-primary/70">模板管理</p>
              <h2 className="mt-1 text-[24px] font-black tracking-tight text-on-surface">风格模板</h2>
              <p className="mt-2 text-[13px] leading-6 text-ui-muted">主界面只保留“选风格”。如果需要维护模板，再在这里编辑。</p>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-5 scrollbar-thin">
              <div className="space-y-4 rounded-[18px] border border-on-surface/8 bg-white p-4 shadow-[0_18px_40px_rgba(36,48,42,0.05)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-primary/70">当前模板</p>
                    <h3 className="mt-1 text-[18px] font-black tracking-tight text-on-surface">选择要编辑的模板</h3>
                  </div>
                  <Button variant="secondary" size="sm" onClick={onReloadTemplates} disabled={templatesLoading || templateActionLoading}>
                    <RefreshCw className={cn("h-4 w-4", templatesLoading && "animate-spin")} />
                    刷新
                  </Button>
                </div>
                <select value={selectedTemplate?.template_id || ""} onChange={(event) => onSelectTemplate(event.target.value)} className="w-full rounded-[12px] border border-on-surface/8 bg-surface-container-low px-3 py-3 text-[14px] text-on-surface outline-none">
                  {templates.map((template) => (
                    <option key={template.template_id} value={template.template_id}>{template.name}</option>
                  ))}
                </select>
                <input value={templateNameDraft} onChange={(event) => onTemplateNameChange(event.target.value)} placeholder="模板名称" className="w-full rounded-[12px] border border-on-surface/8 bg-white px-3 py-3 text-[14px] outline-none" />
                <input value={templateDescriptionDraft} onChange={(event) => onTemplateDescriptionChange(event.target.value)} placeholder="模板说明" className="w-full rounded-[12px] border border-on-surface/8 bg-white px-3 py-3 text-[14px] outline-none" />
                <textarea value={templatePromptDraft} onChange={(event) => onTemplatePromptChange(event.target.value)} rows={9} placeholder="模板提示词" className="w-full rounded-[12px] border border-on-surface/8 bg-white px-3 py-3 text-[14px] leading-7 outline-none" />
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" size="sm" onClick={onCreateTemplate} loading={templateActionLoading}><Plus className="h-4 w-4" />新建模板</Button>
                  <Button variant="secondary" size="sm" onClick={onUpdateTemplate} disabled={!selectedTemplate || selectedTemplate.is_builtin} loading={templateActionLoading}><Save className="h-4 w-4" />更新模板</Button>
                  <Button variant="danger" size="sm" onClick={onDeleteTemplate} disabled={!selectedTemplate || selectedTemplate.is_builtin} loading={templateActionLoading}><Trash2 className="h-4 w-4" />删除模板</Button>
                </div>
                {selectedTemplate?.is_builtin ? <p className="text-[12px] text-ui-muted">内置模板不可直接修改或删除，可另存为新模板。</p> : null}
              </div>
            </div>
            <div className="border-t border-on-surface/8 px-5 py-4">
              <div className="flex justify-end">
                <Button variant="secondary" size="sm" onClick={onClose}>关闭</Button>
              </div>
            </div>
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

export default function IconWorkbenchSimplifiedWorkspace() {
  const baseUrl = getApiBaseUrl();
  const apiToken = getApiToken();
  const desktopReady = isTauriDesktop();
  const iconApi = useMemo(() => createIconWorkbenchApiClient(baseUrl, apiToken), [apiToken, baseUrl]);
  const systemApi = useMemo(() => createApiClient(baseUrl, apiToken), [apiToken, baseUrl]);

  const [session, setSession] = useState<IconWorkbenchSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionLabel, setActionLabel] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [restoreLastConfirmOpen, setRestoreLastConfirmOpen] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [restoreLastLoading, setRestoreLastLoading] = useState(false);
  const [canRestoreCurrentFolder, setCanRestoreCurrentFolder] = useState(false);
  const [templates, setTemplates] = useState<IconTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateActionLoading, setTemplateActionLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateNameDraft, setTemplateNameDraft] = useState("");
  const [templateDescriptionDraft, setTemplateDescriptionDraft] = useState("");
  const [templatePromptDraft, setTemplatePromptDraft] = useState("");
  const [batchApplyLoading, setBatchApplyLoading] = useState(false);
  const [batchApplyReport, setBatchApplyReport] = useState<BatchApplyReport | null>(null);
  const [localFolderOperations, setLocalFolderOperations] = useState<Record<string, LocalFolderOperationState>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setTemplatesLoading(true);
    iconApi.listTemplates()
      .then((items) => { if (!cancelled) { setTemplates(items); } })
      .catch((err) => { if (!cancelled) { setError(err instanceof Error ? err.message : "加载模板列表失败。"); } })
      .finally(() => { if (!cancelled) { setTemplatesLoading(false); setLoading(false); } });
    return () => { cancelled = true; };
  }, [iconApi]);

  useEffect(() => {
    if (templates.length === 0) {
      setSelectedTemplateId("");
      return;
    }
    const current = templates.find((template) => template.template_id === selectedTemplateId) ?? templates[0];
    if (current.template_id !== selectedTemplateId) {
      setSelectedTemplateId(current.template_id);
      return;
    }
    setTemplateNameDraft(current.name);
    setTemplateDescriptionDraft(current.description);
    setTemplatePromptDraft(current.prompt_template);
  }, [selectedTemplateId, templates]);

  useEffect(() => {
    if (!session || session.folders.length === 0) {
      setActiveFolderId(null);
      return;
    }
    if (!session.folders.some((folder) => folder.folder_id === activeFolderId)) {
      setActiveFolderId(session.folders[0].folder_id);
    }
  }, [activeFolderId, session]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const detail = session
      ? `${session.parent_dir.replace(/[\\/]$/, "").split(/[\\/]/).pop() || "图标工坊"} · 已选 ${selectedFolderIds.length} 个`
      : "选择文件夹、选择风格、生成图标";
    window.localStorage.setItem(ICONS_CONTEXT_KEY, JSON.stringify({ detail }));
    window.dispatchEvent(new Event(APP_CONTEXT_EVENT));
  }, [selectedFolderIds.length, session]);

  const folderOperations = useMemo(
    () => ({ ...deriveFolderOperations(session), ...localFolderOperations }),
    [localFolderOperations, session],
  );
  const visibleFolders = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const folders = session?.folders || [];
    if (!keyword) {
      return folders;
    }
    return folders.filter((folder) =>
      [folder.folder_name, folder.folder_path, folder.analysis?.summary || "", folder.analysis?.visual_subject || ""]
        .join(" ")
        .toLowerCase()
        .includes(keyword),
    );
  }, [query, session]);
  const activeFolder = useMemo(
    () => session?.folders.find((folder) => folder.folder_id === activeFolderId) ?? visibleFolders[0] ?? null,
    [activeFolderId, session, visibleFolders],
  );
  const currentVersion = useMemo(() => (activeFolder ? resolvePreviewVersion(activeFolder) : null), [activeFolder]);
  const selectedFolders = useMemo(() => {
    if (!session) {
      return [];
    }
    const selected = new Set(selectedFolderIds);
    return session.folders.filter((folder) => selected.has(folder.folder_id));
  }, [selectedFolderIds, session]);
  const readySelectedCount = useMemo(
    () => selectedFolders.filter((folder) => isFolderReady(folder)).length,
    [selectedFolders],
  );
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.template_id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  );

  useEffect(() => {
    let cancelled = false;
    if (!activeFolder || !desktopReady) {
      setCanRestoreCurrentFolder(false);
      return () => { cancelled = true; };
    }
    invokeTauriCommand<boolean>("can_restore_folder_icon", { folderPath: activeFolder.folder_path })
      .then((result) => { if (!cancelled) { setCanRestoreCurrentFolder(Boolean(result)); } })
      .catch(() => { if (!cancelled) { setCanRestoreCurrentFolder(false); } });
    return () => { cancelled = true; };
  }, [activeFolder, desktopReady]);

  function applySession(nextSession: IconWorkbenchSession) {
    setSession(nextSession);
    setSelectedFolderIds((current) => {
      const available = new Set(nextSession.folders.map((folder) => folder.folder_id));
      return current.filter((folderId) => available.has(folderId));
    });
  }

  function applyOperationResults(actionType: string, results: ApplyIconResult[]) {
    setLocalFolderOperations((current) => {
      const next = { ...current };
      for (const result of results) {
        if (!result.folder_id) {
          continue;
        }
        if (actionType === "apply_icons" && result.status === "applied") {
          next[result.folder_id] = "applied";
        }
        if (actionType === "restore_icons" && result.status === "restored") {
          next[result.folder_id] = "restored";
        }
      }
      return next;
    });
  }

  async function reloadTemplates(preferredTemplateId?: string) {
    const items = await iconApi.listTemplates();
    setTemplates(items);
    if (items.length === 0) {
      setSelectedTemplateId("");
      return;
    }
    const preferred = preferredTemplateId
      ? items.find((template) => template.template_id === preferredTemplateId) ?? null
      : null;
    setSelectedTemplateId(preferred?.template_id || items[0].template_id);
  }

  async function reportClientAction(sessionId: string, actionType: string, results: ApplyIconResult[], skippedItems: ApplyReadySkippedItem[]) {
    const nextSession = await iconApi.reportClientAction(sessionId, {
      action_type: actionType,
      results: results.map((item) => ({
        folder_id: item.folder_id ?? null,
        folder_name: item.folder_name ?? null,
        folder_path: item.folder_path ?? null,
        status: item.status,
        message: item.message,
      })),
      skipped_items: skippedItems.map((item) => ({
        folder_id: item.folder_id,
        folder_name: item.folder_name,
        folder_path: null,
        status: item.status,
        message: item.message,
      })),
    });
    applySession(nextSession);
  }

  async function executeClientAction(sessionId: string, execution: IconWorkbenchClientExecution) {
    if (!desktopReady) {
      throw new Error("这个动作需要在 Windows 桌面壳内执行。");
    }
    const results = execution.command === "restore_ready_icons"
      ? ((await invokeTauriCommand<ApplyIconResult[]>("restore_ready_icons", { tasks: execution.tasks })) || [])
      : ((await invokeTauriCommand<ApplyIconResult[]>("apply_ready_icons", { tasks: execution.tasks })) || []);
    await reportClientAction(sessionId, execution.action_type, results, execution.skipped_items);
    applyOperationResults(execution.action_type, results);
  }

  async function handleConfirmAction(action: IconWorkbenchPendingAction) {
    if (!session) {
      return;
    }
    setActionLoadingId(action.action_id);
    setError(null);
    try {
      const payload = await iconApi.confirmAction(session.session_id, action.action_id);
      applySession(payload.session);
      if (payload.client_execution) {
        await executeClientAction(payload.session.session_id, payload.client_execution);
      } else {
        setNotice(`已确认执行「${action.title}」。`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "确认待执行动作失败。");
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleDismissAction(action: IconWorkbenchPendingAction) {
    if (!session) {
      return;
    }
    setActionLoadingId(action.action_id);
    setError(null);
    try {
      const nextSession = await iconApi.dismissAction(session.session_id, action.action_id);
      applySession(nextSession);
      setNotice(`已取消「${action.title}」。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "取消待执行动作失败。");
    } finally {
      setActionLoadingId(null);
    }
  }

  async function chooseParentDirectory() {
    setError(null);
    const pickedDir = await pickDirectoryWithTauri();
    const selectedDir = pickedDir || (await systemApi.selectDir()).path;
    if (!selectedDir) {
      return;
    }
    setActionLabel("正在载入父目录");
    try {
      const nextSession = await iconApi.createSession(selectedDir);
      setSession(nextSession);
      setSelectedFolderIds([]);
      setActiveFolderId(nextSession.folders[0]?.folder_id || null);
      setQuery("");
      setBatchApplyReport(null);
      setLocalFolderOperations({});
      setNotice(`已扫描 ${nextSession.folder_count} 个子文件夹，请勾选你想美化的项目。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建图标工坊会话失败。");
    } finally {
      setActionLabel(null);
    }
  }

  async function handleRescan() {
    if (!session) {
      return;
    }
    setError(null);
    setActionLabel("正在刷新子文件夹列表");
    try {
      const nextSession = await iconApi.scanSession(session.session_id);
      applySession(nextSession);
      setNotice("文件夹列表已刷新。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "刷新目录失败。");
    } finally {
      setActionLabel(null);
    }
  }

  async function runGenerateFlow(folderIds: string[], actionName: string) {
    if (!session || folderIds.length === 0) {
      return;
    }
    if (!selectedTemplateId) {
      setError("请先选择一个风格模板。");
      return;
    }
    setError(null);
    setActionLabel(`正在${actionName}`);
    setActiveFolderId(folderIds[0]);
    try {
      applySession(await iconApi.analyzeFolders(session.session_id, folderIds));
      applySession(await iconApi.applyTemplate(session.session_id, selectedTemplateId, folderIds));
      applySession(await iconApi.generatePreviews(session.session_id, folderIds));
      setNotice(`${actionName}完成，新的版本已经保留下来。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${actionName}失败。`);
    } finally {
      setActionLabel(null);
    }
  }

  async function handleCreateTemplate() {
    const name = templateNameDraft.trim();
    const promptTemplate = templatePromptDraft.trim();
    if (!name || !promptTemplate) {
      setError("模板名称和模板提示词不能为空。");
      return;
    }
    setTemplateActionLoading(true);
    setError(null);
    try {
      const created = await iconApi.createTemplate({
        name,
        description: templateDescriptionDraft.trim(),
        prompt_template: promptTemplate,
      });
      await reloadTemplates(created.template_id);
      setNotice(`已新增模板「${created.name}」。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "新增模板失败。");
    } finally {
      setTemplateActionLoading(false);
    }
  }

  async function handleUpdateTemplate() {
    if (!selectedTemplate || selectedTemplate.is_builtin) {
      return;
    }
    const name = templateNameDraft.trim();
    const promptTemplate = templatePromptDraft.trim();
    if (!name || !promptTemplate) {
      setError("模板名称和模板提示词不能为空。");
      return;
    }
    setTemplateActionLoading(true);
    setError(null);
    try {
      const updated = await iconApi.updateTemplate(selectedTemplate.template_id, {
        name,
        description: templateDescriptionDraft.trim(),
        prompt_template: promptTemplate,
      });
      await reloadTemplates(updated.template_id);
      setNotice(`已更新模板「${updated.name}」。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新模板失败。");
    } finally {
      setTemplateActionLoading(false);
    }
  }

  async function handleDeleteTemplate() {
    if (!selectedTemplate || selectedTemplate.is_builtin) {
      return;
    }
    setTemplateActionLoading(true);
    setError(null);
    try {
      await iconApi.deleteTemplate(selectedTemplate.template_id);
      await reloadTemplates();
      setNotice(`已删除模板「${selectedTemplate.name}」。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除模板失败。");
    } finally {
      setTemplateActionLoading(false);
    }
  }

  async function handleApplyReadySelected() {
    if (!session || selectedFolderIds.length === 0) {
      return;
    }
    if (!desktopReady) {
      setError("批量应用仅支持 Windows 桌面壳。");
      return;
    }
    setBatchApplyLoading(true);
    setError(null);
    try {
      const preparation = await iconApi.prepareApplyReady(session.session_id, selectedFolderIds);
      const results = preparation.tasks.length > 0 ? await invokeTauriCommand<ApplyIconResult[]>("apply_ready_icons", { tasks: preparation.tasks }) : [];
      const appliedResults = results || [];
      const applied = appliedResults.filter((item) => item.status === "applied").length;
      const failed = appliedResults.filter((item) => item.status !== "applied").length;
      setBatchApplyReport({ total: preparation.total, applied, failed, skipped: preparation.skipped_count, results: appliedResults, skipped_items: preparation.skipped_items });
      applyOperationResults("apply_icons", appliedResults);
      await reportClientAction(session.session_id, "apply_icons", appliedResults, preparation.skipped_items);
      setNotice(`批量应用完成：成功 ${applied}，失败 ${failed}，跳过 ${preparation.skipped_count}。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量应用失败。");
    } finally {
      setBatchApplyLoading(false);
    }
  }

  async function handleSelectVersion(versionId: string) {
    if (!session || !activeFolder) {
      return;
    }
    try {
      applySession(await iconApi.selectVersion(session.session_id, activeFolder.folder_id, versionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换版本失败。");
    }
  }

  async function handleApplyCurrentVersion() {
    if (!session || !activeFolder || !currentVersion || currentVersion.status !== "ready") {
      return;
    }
    setApplyLoading(true);
    setError(null);
    try {
      const result = await invokeTauriCommand<string>("apply_folder_icon", { folderPath: activeFolder.folder_path, imagePath: currentVersion.image_path });
      const results: ApplyIconResult[] = [{ folder_id: activeFolder.folder_id, folder_name: activeFolder.folder_name, folder_path: activeFolder.folder_path, status: "applied", message: result || `已应用图标: ${activeFolder.folder_path}` }];
      await reportClientAction(session.session_id, "apply_icons", results, []);
      applyOperationResults("apply_icons", results);
      setCanRestoreCurrentFolder(true);
      setNotice(result || "已将当前图标应用到文件夹。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "应用图标失败。");
    } finally {
      setApplyLoading(false);
    }
  }

  async function handleRestoreDefaultIcon() {
    if (!activeFolder) {
      return;
    }
    setApplyLoading(true);
    setError(null);
    try {
      const result = await invokeTauriCommand<string>("clear_folder_icon", { folderPath: activeFolder.folder_path });
      setRestoreConfirmOpen(false);
      setCanRestoreCurrentFolder(false);
      setLocalFolderOperations((current) => ({ ...current, [activeFolder.folder_id]: "cleared" }));
      setNotice(result || "已恢复系统默认图标。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "恢复默认图标失败。");
    } finally {
      setApplyLoading(false);
    }
  }

  async function handleRestoreLastIcon() {
    if (!session || !activeFolder) {
      return;
    }
    setRestoreLastLoading(true);
    setError(null);
    try {
      const result = await invokeTauriCommand<string>("restore_last_folder_icon", { folderPath: activeFolder.folder_path });
      const results: ApplyIconResult[] = [{ folder_id: activeFolder.folder_id, folder_name: activeFolder.folder_name, folder_path: activeFolder.folder_path, status: "restored", message: result || `已恢复最近一次图标状态: ${activeFolder.folder_path}` }];
      await reportClientAction(session.session_id, "restore_icons", results, []);
      applyOperationResults("restore_icons", results);
      setRestoreLastConfirmOpen(false);
      setCanRestoreCurrentFolder(true);
      setNotice(result || "已恢复最近一次图标状态。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "恢复最近一次图标失败。");
    } finally {
      setRestoreLastLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex items-center gap-3 rounded-[16px] border border-on-surface/8 bg-surface-container-lowest px-6 py-4 shadow-[0_18px_48px_rgba(36,48,42,0.08)]">
          <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
          <p className="text-[14px] font-semibold text-on-surface">正在初始化图标工坊...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden bg-surface">
        <div className="border-b border-on-surface/8 bg-surface-container-lowest/96 px-4 py-5 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-[760px] space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-[16px] border border-primary/12 bg-primary/10 text-primary"><Palette className="h-5 w-5" /></div>
                <div><p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-primary/70">ICON WORKBENCH</p><h1 className="text-[28px] font-black tracking-tight text-on-surface">图标工坊</h1></div>
              </div>
              <p className="max-w-[720px] text-[14px] leading-7 text-ui-muted">简化后的流程只做三件事：选中文件夹、选风格、生成版本。满意了就应用，不满意就再生成一次。</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => { if (typeof window !== "undefined") { window.location.href = "/settings"; } }}>应用设置</Button>
              <Button variant="primary" size="sm" onClick={() => void chooseParentDirectory()}><FolderOpen className="h-4 w-4" />选择父目录</Button>
            </div>
          </div>
        </div>
        <StatusBar actionLabel={actionLabel} notice={notice} error={error} pendingActions={[]} batchApplyReport={null} actionLoadingId={null} desktopReady={desktopReady} onConfirmAction={() => undefined} onDismissAction={() => undefined} onClearNotice={() => setNotice(null)} onClearBatchReport={() => undefined} />
        <div className="flex flex-1 items-center justify-center px-6">
          <EmptyState icon={FolderCog} title="从一个父目录开始" description="选中父目录后，图标工坊会列出里面的子文件夹。你只需要勾选想美化的项目、选择风格，然后开始生成。">
            <Button variant="primary" size="lg" onClick={() => void chooseParentDirectory()}><FolderOpen className="h-4 w-4" />选择父目录</Button>
          </EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-surface">
      <div className="border-b border-on-surface/8 bg-surface-container-lowest/96 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-[760px] space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-[16px] border border-primary/12 bg-primary/10 text-primary"><Palette className="h-5 w-5" /></div>
              <div><p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-primary/70">ICON WORKBENCH</p><h1 className="text-[28px] font-black tracking-tight text-on-surface">{session.parent_dir.replace(/[\\/]$/, "").split(/[\\/]/).pop() || "图标工坊"}</h1></div>
            </div>
            <p className="max-w-[720px] text-[14px] leading-7 text-ui-muted">勾选想美化的文件夹，挑一个风格模板，然后开始生成。系统会自动分析目录主题并拼接风格，不再要求你手动编辑提示词。</p>
            <div className="flex flex-wrap gap-3 text-[12px]">
              <span className="rounded-full border border-on-surface/8 bg-white px-3 py-1.5 text-ui-muted">已扫描 {session.folder_count} 个文件夹</span>
              <span className="rounded-full border border-on-surface/8 bg-white px-3 py-1.5 text-ui-muted">已选 {selectedFolderIds.length} 个</span>
              <span className="rounded-full border border-on-surface/8 bg-white px-3 py-1.5 text-ui-muted">已就绪 {readySelectedCount} 个</span>
              <span className="rounded-full border border-on-surface/8 bg-white px-3 py-1.5 text-ui-muted">风格 {selectedTemplate?.name || "未选择"}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void chooseParentDirectory()}><FolderOpen className="h-4 w-4" />选择父目录</Button>
            <Button variant="secondary" size="sm" onClick={() => void handleRescan()} disabled={Boolean(actionLabel)}><RefreshCw className="h-4 w-4" />重新扫描</Button>
            <Button variant="secondary" size="sm" onClick={() => { if (typeof window !== "undefined") { window.location.href = "/settings"; } }}>应用设置</Button>
          </div>
        </div>
      </div>
      <StatusBar
        actionLabel={actionLabel}
        notice={notice}
        error={error}
        pendingActions={session.pending_actions || []}
        batchApplyReport={batchApplyReport}
        actionLoadingId={actionLoadingId}
        desktopReady={desktopReady}
        onConfirmAction={(action) => void handleConfirmAction(action)}
        onDismissAction={(action) => void handleDismissAction(action)}
        onClearNotice={() => setNotice(null)}
        onClearBatchReport={() => setBatchApplyReport(null)}
      />
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden px-4 py-4 xl:grid-cols-[420px_minmax(0,1fr)] xl:px-6">
        <div className="min-h-0 space-y-4 overflow-y-auto pr-1 scrollbar-thin">
          <section className="rounded-[24px] border border-on-surface/8 bg-white px-5 py-5 shadow-[0_10px_30px_rgba(36,48,42,0.06)]">
            <div className="flex items-start gap-4"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-primary/12 bg-primary/10 text-[13px] font-black text-primary">1</div><div><h2 className="text-[20px] font-black tracking-tight text-on-surface">选择文件夹</h2><p className="mt-1 text-[13px] leading-6 text-ui-muted">勾选你想美化的文件夹，点击某一项可在右侧查看它的版本。</p></div></div>
            <div className="mt-5 flex items-center gap-2 rounded-[16px] border border-on-surface/8 bg-surface-container-low px-3 py-2.5"><Search className="h-4 w-4 text-ui-muted" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件夹名称" className="w-full bg-transparent text-[14px] outline-none placeholder:text-ui-muted" /></div>
            <div className="mt-4 flex items-center justify-between text-[12px]"><button type="button" className="font-semibold text-primary hover:text-primary-dim" onClick={() => setSelectedFolderIds(visibleFolders.map((folder) => folder.folder_id))}>全选当前可见项</button><button type="button" className="font-semibold text-ui-muted hover:text-on-surface" onClick={() => setSelectedFolderIds([])}>清空选择</button></div>
            <div className="mt-4 max-h-[420px] space-y-2 overflow-y-auto pr-1 scrollbar-thin">
              {visibleFolders.length === 0 ? <div className="rounded-[18px] border border-dashed border-on-surface/10 bg-surface-container-low px-4 py-8 text-center text-[13px] leading-6 text-ui-muted">当前没有可见文件夹，试试重新选择父目录或调整搜索条件。</div> : visibleFolders.map((folder) => {
                const checked = selectedFolderIds.includes(folder.folder_id);
                const active = activeFolder?.folder_id === folder.folder_id;
                const previewVersion = resolvePreviewVersion(folder);
                const summary = summarizeFolder(folder, folderOperations);
                return (
                  <button key={folder.folder_id} type="button" onClick={() => setActiveFolderId(folder.folder_id)} className={cn("w-full rounded-[18px] border px-3 py-3 text-left transition-all", active ? "border-primary/18 bg-primary/6 shadow-[0_12px_28px_rgba(36,48,42,0.08)]" : "border-on-surface/8 bg-white hover:border-primary/14")}>
                    <div className="flex items-start gap-3">
                      <input type="checkbox" checked={checked} onChange={(event) => setSelectedFolderIds((current) => event.target.checked ? Array.from(new Set([...current, folder.folder_id])) : current.filter((item) => item !== folder.folder_id))} onClick={(event) => event.stopPropagation()} className="mt-1 h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary" />
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[14px] border border-on-surface/8 bg-surface-container-low">{previewVersion && previewVersion.status === "ready" ? <img src={buildImageSrc(previewVersion, baseUrl, apiToken)} alt={folder.folder_name} className="h-full w-full object-cover" /> : <Palette className="h-5 w-5 text-primary/40" />}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate text-[15px] font-bold tracking-tight text-on-surface">{folder.folder_name}</h3><p className="mt-1 text-[12px] text-ui-muted">{folder.versions.length} 个版本</p></div><span className={cn("rounded-full border px-2 py-1 text-[11px] font-semibold", statusClassName(summary.tone))}>{summary.label}</span></div>
                        <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-ui-muted">{folder.last_error || folder.analysis?.summary || folder.folder_path}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
          <section className="rounded-[24px] border border-on-surface/8 bg-white px-5 py-5 shadow-[0_10px_30px_rgba(36,48,42,0.06)]">
            <div className="flex items-start gap-4"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-primary/12 bg-primary/10 text-[13px] font-black text-primary">2</div><div><h2 className="text-[20px] font-black tracking-tight text-on-surface">选择风格</h2><p className="mt-1 text-[13px] leading-6 text-ui-muted">只需要挑风格，不需要手动修改主题描述词。</p></div></div>
            <div className="mt-5 space-y-2">{templates.map((template) => <button key={template.template_id} type="button" onClick={() => setSelectedTemplateId(template.template_id)} className={cn("w-full rounded-[18px] border px-4 py-3 text-left transition-all", template.template_id === selectedTemplateId ? "border-primary/18 bg-primary/6 shadow-[0_12px_28px_rgba(36,48,42,0.08)]" : "border-on-surface/8 bg-white hover:border-primary/14")}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="text-[15px] font-bold tracking-tight text-on-surface">{template.name}</h3><p className="mt-1 text-[13px] leading-6 text-ui-muted">{template.description || "未填写模板说明。"}</p></div>{template.template_id === selectedTemplateId ? <span className="rounded-full border border-primary/18 bg-primary/10 px-2 py-1 text-[11px] font-semibold text-primary">当前风格</span> : null}</div></button>)}</div>
            <div className="mt-4 flex items-center justify-between gap-3 rounded-[18px] border border-on-surface/8 bg-surface-container-low px-4 py-3"><div className="text-[13px] leading-6 text-ui-muted">当前风格：<span className="font-semibold text-on-surface">{selectedTemplate?.name || "未选择"}</span></div><Button variant="secondary" size="sm" onClick={() => setSettingsOpen(true)}>管理模板</Button></div>
          </section>
          <section className="rounded-[24px] border border-on-surface/8 bg-white px-5 py-5 shadow-[0_10px_30px_rgba(36,48,42,0.06)]">
            <div className="flex items-start gap-4"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-primary/12 bg-primary/10 text-[13px] font-black text-primary">3</div><div><h2 className="text-[20px] font-black tracking-tight text-on-surface">开始生成</h2><p className="mt-1 text-[13px] leading-6 text-ui-muted">系统会自动分析目录、套用风格并生成版本。不满意就再生成一次，或者换风格后重来。</p></div></div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-[18px] border border-on-surface/8 bg-surface-container-low px-4 py-3"><p className="text-[11px] uppercase tracking-[0.18em] text-ui-muted">已选文件夹</p><p className="mt-2 text-[22px] font-black tracking-tight text-on-surface">{selectedFolderIds.length}</p></div><div className="rounded-[18px] border border-on-surface/8 bg-surface-container-low px-4 py-3"><p className="text-[11px] uppercase tracking-[0.18em] text-ui-muted">当前风格</p><p className="mt-2 text-[16px] font-bold tracking-tight text-on-surface">{selectedTemplate?.name || "未选择"}</p></div></div>
            <div className="mt-4 grid gap-2"><Button variant="primary" size="lg" onClick={() => void runGenerateFlow(selectedFolderIds, "为已选文件夹生成图标")} disabled={selectedFolderIds.length === 0 || !selectedTemplateId || Boolean(actionLabel)}><Sparkles className="h-4 w-4" />为已选文件夹开始生成</Button><Button variant="secondary" size="lg" onClick={() => void runGenerateFlow(activeFolder ? [activeFolder.folder_id] : [], "为当前文件夹重新生成图标")} disabled={!activeFolder || !selectedTemplateId || Boolean(actionLabel)}><ImagePlus className="h-4 w-4" />为当前文件夹重新生成</Button></div>
          </section>
        </div>
        <div className="min-h-0 overflow-y-auto scrollbar-thin">
          {!activeFolder ? <div className="flex h-full items-center justify-center rounded-[28px] border border-dashed border-on-surface/10 bg-white/78 px-8"><EmptyState icon={ImagePlus} title="先从左侧选一个文件夹" description="你勾选要美化的文件夹后，右侧会显示预览、版本切换和应用操作。" /></div> : <div className="flex h-full min-h-0 flex-col gap-4">
            <section className="rounded-[28px] border border-on-surface/8 bg-white px-6 py-5 shadow-[0_14px_36px_rgba(36,48,42,0.08)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2"><p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-primary/70">当前结果</p><h2 className="text-[30px] font-black tracking-tight text-on-surface">{activeFolder.folder_name}</h2><div className="flex flex-wrap gap-2 text-[12px] text-ui-muted"><span className="rounded-full border border-on-surface/8 bg-surface-container-low px-3 py-1.5">风格 {selectedTemplate?.name || "未选择"}</span><span className="rounded-full border border-on-surface/8 bg-surface-container-low px-3 py-1.5">当前版本 {currentVersion ? `v${currentVersion.version_number}` : "尚未生成"}</span><span className="rounded-full border border-on-surface/8 bg-surface-container-low px-3 py-1.5">更新于 {formatDisplayDate(activeFolder.updated_at)}</span></div></div>
                <div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" onClick={() => void runGenerateFlow([activeFolder.folder_id], "为当前文件夹重新生成图标")}><RefreshCw className="h-4 w-4" />重新生成</Button><Button variant="secondary" size="sm" onClick={() => void handleApplyReadySelected()} disabled={readySelectedCount === 0 || !desktopReady} loading={batchApplyLoading}><Sparkles className="h-4 w-4" />应用已就绪 {readySelectedCount > 0 ? `(${readySelectedCount})` : ""}</Button><Button variant="primary" size="sm" onClick={() => void handleApplyCurrentVersion()} disabled={!desktopReady || !currentVersion || currentVersion.status !== "ready"} loading={applyLoading}><Check className="h-4 w-4" />应用当前版本</Button></div>
              </div>
            </section>
            <section className="flex min-h-0 flex-1 flex-col rounded-[30px] border border-on-surface/8 bg-white shadow-[0_16px_42px_rgba(36,48,42,0.08)]">
              <div className="min-h-0 flex-1 p-5"><div className="flex h-full min-h-[360px] items-center justify-center overflow-hidden rounded-[24px] border border-on-surface/8 bg-[radial-gradient(circle_at_top,rgba(77,99,87,0.14),rgba(255,255,255,0.92)_60%)]">{currentVersion && currentVersion.status === "ready" ? <img src={buildImageSrc(currentVersion, baseUrl, apiToken)} alt={activeFolder.folder_name} className="max-h-[680px] w-full object-contain" /> : <div className="space-y-4 px-8 text-center"><BrushCleaning className="mx-auto h-12 w-12 text-primary/40" /><div className="space-y-1"><p className="text-[18px] font-bold text-on-surface">还没有生成图标</p><p className="max-w-[440px] text-[13px] leading-6 text-ui-muted">先在左侧选中文件夹和风格，然后点击“开始生成”。生成后你可以在这里切换不同版本。</p></div></div>}</div></div>
              <div className="border-t border-on-surface/8 px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-primary/70">版本切换</p><h3 className="mt-1 text-[20px] font-black tracking-tight text-on-surface">保留每一次生成结果</h3></div><div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" onClick={() => setRestoreLastConfirmOpen(true)} disabled={!desktopReady || !canRestoreCurrentFolder} loading={restoreLastLoading}><RefreshCw className="h-4 w-4" />恢复最近一次</Button><Button variant="secondary" size="sm" onClick={() => setRestoreConfirmOpen(true)} disabled={!desktopReady}><BrushCleaning className="h-4 w-4" />恢复默认图标</Button><Button variant="ghost" size="sm" onClick={() => void systemApi.openDir(activeFolder.folder_path)}><FolderOpen className="h-4 w-4" />打开目录</Button></div></div>
                {activeFolder.versions.length === 0 ? <div className="mt-4 rounded-[20px] border border-dashed border-on-surface/10 bg-surface-container-low px-4 py-6 text-center text-[13px] text-ui-muted">生成版本后，这里会保留缩略图，方便你来回切换和比较。</div> : <div className="mt-4 flex gap-3 overflow-x-auto pb-1 scrollbar-thin">{activeFolder.versions.map((version) => <button key={version.version_id} type="button" onClick={() => void handleSelectVersion(version.version_id)} className={cn("w-[180px] shrink-0 rounded-[18px] border p-3 text-left transition-all", version.version_id === activeFolder.current_version_id ? "border-primary/18 bg-primary/6" : "border-on-surface/8 bg-surface-container-low hover:border-primary/14")}><div className="overflow-hidden rounded-[14px] border border-on-surface/8 bg-white">{version.status === "ready" ? <img src={buildImageSrc(version, baseUrl, apiToken)} alt={`version-${version.version_number}`} className="aspect-square w-full object-cover" /> : <div className="flex aspect-square items-center justify-center text-error"><AlertTriangle className="h-6 w-6" /></div>}</div><div className="mt-3 flex items-center justify-between gap-2"><p className="text-[14px] font-bold text-on-surface">v{version.version_number}</p><span className={cn("rounded-full border px-2 py-1 text-[11px] font-semibold", statusClassName(version.status === "ready" ? "success" : "error"))}>{version.status === "ready" ? "可用" : "失败"}</span></div><p className="mt-2 text-[12px] leading-5 text-ui-muted">{formatDisplayDate(version.created_at)}</p>{version.error_message ? <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-error">{version.error_message}</p> : null}</button>)}</div>}
                <details className="mt-5 rounded-[18px] border border-on-surface/8 bg-surface-container-low px-4 py-3"><summary className="cursor-pointer list-none text-[13px] font-semibold text-on-surface">查看系统自动识别的主题</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><div className="rounded-[14px] border border-on-surface/8 bg-white px-3 py-3"><p className="text-[11px] uppercase tracking-[0.18em] text-ui-muted">视觉主体</p><p className="mt-2 text-[14px] font-semibold text-on-surface">{activeFolder.analysis?.visual_subject || "尚未识别"}</p></div><div className="rounded-[14px] border border-on-surface/8 bg-white px-3 py-3"><p className="text-[11px] uppercase tracking-[0.18em] text-ui-muted">分类</p><p className="mt-2 text-[14px] font-semibold text-on-surface">{activeFolder.analysis?.category || "尚未识别"}</p></div></div><div className="mt-3 rounded-[14px] border border-on-surface/8 bg-white px-3 py-3"><p className="text-[11px] uppercase tracking-[0.18em] text-ui-muted">分析摘要</p><p className="mt-2 text-[13px] leading-6 text-ui-muted">{activeFolder.analysis?.summary || "系统会在生成前自动分析目录结构，这里只做查看，不需要手动修改。"}</p></div></details>
              </div>
            </section>
          </div>}
        </div>
      </div>
      <TemplateDrawer open={settingsOpen} templates={templates} templatesLoading={templatesLoading} selectedTemplate={selectedTemplate} templateNameDraft={templateNameDraft} templateDescriptionDraft={templateDescriptionDraft} templatePromptDraft={templatePromptDraft} templateActionLoading={templateActionLoading} onClose={() => setSettingsOpen(false)} onSelectTemplate={setSelectedTemplateId} onTemplateNameChange={setTemplateNameDraft} onTemplateDescriptionChange={setTemplateDescriptionDraft} onTemplatePromptChange={setTemplatePromptDraft} onReloadTemplates={() => void reloadTemplates(selectedTemplateId)} onCreateTemplate={() => void handleCreateTemplate()} onUpdateTemplate={() => void handleUpdateTemplate()} onDeleteTemplate={() => void handleDeleteTemplate()} />
      <ConfirmDialog open={restoreConfirmOpen} title="恢复系统默认图标" description={`会移除 ${activeFolder?.folder_name || "当前文件夹"} 的自定义图标并请求 Explorer 刷新显示。`} confirmLabel="确认恢复" cancelLabel="取消" onConfirm={() => void handleRestoreDefaultIcon()} onCancel={() => setRestoreConfirmOpen(false)} loading={applyLoading} />
      <ConfirmDialog open={restoreLastConfirmOpen} title="恢复最近一次图标状态" description={`会把 ${activeFolder?.folder_name || "当前文件夹"} 恢复到最近一次应用前的图标状态，并刷新 Explorer 显示。`} confirmLabel="确认恢复" cancelLabel="取消" onConfirm={() => void handleRestoreLastIcon()} onCancel={() => setRestoreLastConfirmOpen(false)} loading={restoreLastLoading} />
    </div>
  );
}
