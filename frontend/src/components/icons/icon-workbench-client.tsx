"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
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
  Settings2,
  Sparkles,
  Trash2,
  WandSparkles,
  Eye,
  EyeOff,
} from "lucide-react";

import { IconChatPanel } from "@/components/icons/icon-chat-panel";
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
  IconTemplate,
  IconWorkbenchClientExecution,
  IconWorkbenchPendingAction,
  IconPreviewVersion,
  IconWorkbenchConfig,
  IconWorkbenchSession,
} from "@/types/icon-workbench";

const APP_CONTEXT_EVENT = "file-organizer-context-change";
const ICONS_CONTEXT_KEY = "icons_header_context";

const DEFAULT_CONFIG: IconWorkbenchConfig = {
  text_model: { base_url: "", api_key: "", model: "" },
  image_model: { base_url: "", api_key: "", model: "" },
  image_size: "1024x1024",
  concurrency_limit: 1,
};

type BatchApplyReport = {
  total: number;
  applied: number;
  failed: number;
  skipped: number;
  results: ApplyIconResult[];
  skipped_items: ApplyReadySkippedItem[];
};

function summarizeFolder(folder: FolderIconCandidate) {
  if (folder.last_error) {
    return { label: "异常", tone: "error" as const };
  }
  if (folder.current_version_id) {
    const current = folder.versions.find((version) => version.version_id === folder.current_version_id);
    if (current?.status === "ready") {
      return { label: `v${current.version_number} 已就绪`, tone: "success" as const };
    }
  }
  if (folder.analysis_status === "ready") {
    return { label: "已分析", tone: "ready" as const };
  }
  if (folder.analysis_status === "error") {
    return { label: "分析失败", tone: "error" as const };
  }
  return { label: "待处理", tone: "idle" as const };
}

function statusClassName(tone: "success" | "ready" | "error" | "idle") {
  switch (tone) {
    case "success":
      return "border-primary/14 bg-primary/10 text-primary";
    case "ready":
      return "border-primary/10 bg-primary/6 text-primary-dim";
    case "error":
      return "border-error/14 bg-error-container/50 text-error";
    default:
      return "border-on-surface/8 bg-surface-container-low text-ui-muted";
  }
}

function buildImageSrc(version: IconPreviewVersion, baseUrl: string, apiToken: string) {
  const url = new URL(version.image_url.replace(/^\//, ""), `${baseUrl.replace(/\/$/, "")}/`);
  if (apiToken) {
    url.searchParams.set("access_token", apiToken);
  }
  return url.toString();
}

function TogglePasswordButton({
  visible,
  onToggle,
}: {
  visible: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ui-muted transition-colors hover:bg-surface-container-low hover:text-on-surface"
    >
      {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </button>
  );
}

function FieldShell({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-semibold tracking-[0.02em] text-ui-muted">{label}</span>
        {hint ? <span className="text-[11px] text-ui-muted">{hint}</span> : null}
      </div>
      {children}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-full rounded-[10px] border border-on-surface/8 bg-white px-3 py-2.5 text-[14px] text-on-surface outline-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/6"
    />
  );
}

export default function IconWorkbenchClient() {
  const baseUrl = getApiBaseUrl();
  const apiToken = getApiToken();
  const iconApi = useMemo(() => createIconWorkbenchApiClient(baseUrl, apiToken), [apiToken, baseUrl]);
  const systemApi = useMemo(() => createApiClient(baseUrl, apiToken), [apiToken, baseUrl]);

  const [session, setSession] = useState<IconWorkbenchSession | null>(null);
  const [config, setConfig] = useState<IconWorkbenchConfig>(DEFAULT_CONFIG);
  const [configDraft, setConfigDraft] = useState<IconWorkbenchConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLabel, setActionLabel] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [showTextSecret, setShowTextSecret] = useState(false);
  const [showImageSecret, setShowImageSecret] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    iconApi.getConfig()
      .then((nextConfig) => {
        if (cancelled) {
          return;
        }
        setConfig(nextConfig);
        setConfigDraft(nextConfig);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载图标工坊配置失败。");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [iconApi]);

  useEffect(() => {
    let cancelled = false;
    setTemplatesLoading(true);
    iconApi.listTemplates()
      .then((items) => {
        if (cancelled) {
          return;
        }
        setTemplates(items);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载模板列表失败。");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setTemplatesLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [iconApi]);

  useEffect(() => {
    if (!session || session.folders.length === 0) {
      setActiveFolderId(null);
      return;
    }
    const stillExists = session.folders.some((folder) => folder.folder_id === activeFolderId);
    if (!stillExists) {
      setActiveFolderId(session.folders[0].folder_id);
    }
  }, [activeFolderId, session]);

  useEffect(() => {
    const activeFolder = session?.folders.find((folder) => folder.folder_id === activeFolderId) ?? null;
    setPromptDraft(activeFolder?.current_prompt || activeFolder?.analysis?.suggested_prompt || "");
  }, [activeFolderId, session]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const detail = session
      ? `${session.parent_dir.replace(/[\\/]$/, "").split(/[\\/]/).pop() || "图标工坊"} · ${session.ready_count}/${session.folder_count} 就绪`
      : "分析文件夹并生成 Windows 图标";
    window.localStorage.setItem(ICONS_CONTEXT_KEY, JSON.stringify({ detail }));
    window.dispatchEvent(new Event(APP_CONTEXT_EVENT));
  }, [session]);

  const filteredFolders = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const folders = session?.folders || [];
    if (!keyword) {
      return folders;
    }
    return folders.filter((folder) =>
      [folder.folder_name, folder.folder_path, folder.analysis?.category || ""]
        .join(" ")
        .toLowerCase()
        .includes(keyword),
    );
  }, [query, session]);

  const activeFolder = useMemo(
    () => session?.folders.find((folder) => folder.folder_id === activeFolderId) ?? filteredFolders[0] ?? null,
    [activeFolderId, filteredFolders, session],
  );

  const currentVersion = useMemo(() => {
    if (!activeFolder?.current_version_id) {
      return null;
    }
    return activeFolder.versions.find((version) => version.version_id === activeFolder.current_version_id) ?? null;
  }, [activeFolder]);

  useEffect(() => {
    let cancelled = false;
    if (!activeFolder || !isTauriDesktop()) {
      setCanRestoreCurrentFolder(false);
      return () => {
        cancelled = true;
      };
    }

    invokeTauriCommand<boolean>("can_restore_folder_icon", {
      folder_path: activeFolder.folder_path,
    })
      .then((result) => {
        if (!cancelled) {
          setCanRestoreCurrentFolder(Boolean(result));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCanRestoreCurrentFolder(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeFolder]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.template_id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  );

  useEffect(() => {
    if (templates.length === 0) {
      setSelectedTemplateId("");
      setTemplateNameDraft("");
      setTemplateDescriptionDraft("");
      setTemplatePromptDraft("");
      return;
    }
    const hasSelected = templates.some((template) => template.template_id === selectedTemplateId);
    const nextSelected = hasSelected ? selectedTemplateId : templates[0].template_id;
    if (nextSelected !== selectedTemplateId) {
      setSelectedTemplateId(nextSelected);
      return;
    }
    const current = templates.find((template) => template.template_id === nextSelected);
    if (current) {
      setTemplateNameDraft(current.name);
      setTemplateDescriptionDraft(current.description);
      setTemplatePromptDraft(current.prompt_template);
    }
  }, [selectedTemplateId, templates]);

  function applySession(nextSession: IconWorkbenchSession, selectAllNew = false) {
    setSession(nextSession);
    setSelectedFolderIds((current) => {
      const available = new Set(nextSession.folders.map((folder) => folder.folder_id));
      if (selectAllNew || current.length === 0) {
        return nextSession.folders.map((folder) => folder.folder_id);
      }
      const kept = current.filter((folderId) => available.has(folderId));
      const added = nextSession.folders.map((folder) => folder.folder_id).filter((folderId) => !kept.includes(folderId));
      return [...kept, ...added];
    });
  }

  async function reloadTemplates(preferredTemplateId?: string) {
    const items = await iconApi.listTemplates();
    setTemplates(items);
    if (items.length === 0) {
      setSelectedTemplateId("");
      return items;
    }
    const preferredExists = preferredTemplateId && items.some((template) => template.template_id === preferredTemplateId);
    if (preferredExists) {
      setSelectedTemplateId(preferredTemplateId);
      return items;
    }
    if (!items.some((template) => template.template_id === selectedTemplateId)) {
      setSelectedTemplateId(items[0].template_id);
    }
    return items;
  }

  async function reportClientAction(
    sessionId: string,
    actionType: string,
    results: ApplyIconResult[],
    skippedItems: ApplyReadySkippedItem[],
  ) {
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
    return nextSession;
  }

  async function executeClientAction(sessionId: string, execution: IconWorkbenchClientExecution) {
    if (!isTauriDesktop()) {
      throw new Error("这个动作需要在 Windows 桌面壳内执行。");
    }

    let results: ApplyIconResult[] = [];
    if (execution.command === "apply_ready_icons") {
      results =
        ((await invokeTauriCommand<ApplyIconResult[]>("apply_ready_icons", {
          tasks: execution.tasks,
        })) || []);
    } else if (execution.command === "restore_ready_icons") {
      results =
        ((await invokeTauriCommand<ApplyIconResult[]>("restore_ready_icons", {
          tasks: execution.tasks,
        })) || []);
    } else {
      throw new Error(`不支持的桌面命令: ${execution.command}`);
    }

    await reportClientAction(sessionId, execution.action_type, results, execution.skipped_items);
    const successStatuses = execution.action_type === "restore_icons" ? ["restored"] : ["applied"];
    const successCount = results.filter((item) => successStatuses.includes(item.status)).length;
    const failedCount = results.length - successCount;
    setNotice(
      execution.action_type === "restore_icons"
        ? `恢复完成：成功 ${successCount}，失败 ${failedCount}，跳过 ${execution.skipped_items.length}。`
        : `应用完成：成功 ${successCount}，失败 ${failedCount}，跳过 ${execution.skipped_items.length}。`,
    );
  }

  async function handleSendMessage() {
    if (!session || !chatInput.trim()) {
      return;
    }
    setChatLoading(true);
    setError(null);
    try {
      const nextSession = await iconApi.sendMessage(session.session_id, {
        content: chatInput.trim(),
        selected_folder_ids: selectedFolderIds,
        active_folder_id: activeFolderId,
      });
      applySession(nextSession);
      setChatInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送图标工坊消息失败。");
    } finally {
      setChatLoading(false);
    }
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
      applySession(nextSession, true);
      setNotice("已建立图标工坊会话。");
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

  async function handleAnalyzeSelected() {
    if (!session || selectedFolderIds.length === 0) {
      return;
    }
    setError(null);
    setActionLabel("正在分析选中文件夹");
    try {
      const nextSession = await iconApi.analyzeFolders(session.session_id, selectedFolderIds);
      applySession(nextSession);
      setNotice("目录语义分析已更新。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "分析文件夹失败。");
    } finally {
      setActionLabel(null);
    }
  }

  async function handleGenerateSelected() {
    if (!session || selectedFolderIds.length === 0) {
      return;
    }
    setError(null);
    setActionLabel("正在生成图标预览");
    try {
      const nextSession = await iconApi.generatePreviews(session.session_id, selectedFolderIds);
      applySession(nextSession);
      setNotice("新的预览版本已生成。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成图标失败。");
    } finally {
      setActionLabel(null);
    }
  }

  async function handleApplyTemplateToSelected() {
    if (!session || !selectedTemplateId || selectedFolderIds.length === 0) {
      return;
    }
    setError(null);
    setActionLabel("正在套用模板");
    try {
      const nextSession = await iconApi.applyTemplate(session.session_id, selectedTemplateId, selectedFolderIds);
      applySession(nextSession);
      const templateName = templates.find((template) => template.template_id === selectedTemplateId)?.name || "模板";
      setNotice(`已套用模板「${templateName}」。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "套用模板失败。");
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
    if (!isTauriDesktop()) {
      setError("批量应用仅支持 Windows 桌面壳。");
      return;
    }
    setBatchApplyLoading(true);
    setError(null);
    try {
      const preparation = await iconApi.prepareApplyReady(session.session_id, selectedFolderIds);
      const results =
        preparation.tasks.length > 0
          ? await invokeTauriCommand<ApplyIconResult[]>("apply_ready_icons", { tasks: preparation.tasks })
          : [];
      const appliedResults = results || [];
      const applied = appliedResults.filter((item) => item.status === "applied").length;
      const failed = appliedResults.filter((item) => item.status !== "applied").length;
      const report: BatchApplyReport = {
        total: preparation.total,
        applied,
        failed,
        skipped: preparation.skipped_count,
        results: appliedResults,
        skipped_items: preparation.skipped_items,
      };
      setBatchApplyReport(report);
      await reportClientAction(session.session_id, "apply_icons", appliedResults, preparation.skipped_items);
      setNotice(`批量应用完成：成功 ${applied}，失败 ${failed}，跳过 ${report.skipped}。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "批量应用失败。");
    } finally {
      setBatchApplyLoading(false);
    }
  }

  async function handleSavePrompt() {
    if (!session || !activeFolder) {
      return;
    }
    setError(null);
    setActionLabel("正在保存提示词");
    try {
      const nextSession = await iconApi.updatePrompt(session.session_id, activeFolder.folder_id, promptDraft);
      applySession(nextSession);
      setNotice("当前文件夹的提示词已保存。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存提示词失败。");
    } finally {
      setActionLabel(null);
    }
  }

  async function handleSelectVersion(versionId: string) {
    if (!session || !activeFolder) {
      return;
    }
    try {
      const nextSession = await iconApi.selectVersion(session.session_id, activeFolder.folder_id, versionId);
      applySession(nextSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : "切换版本失败。");
    }
  }

  async function handleApplyCurrentVersion() {
    if (!session || !activeFolder || !currentVersion) {
      return;
    }
    setApplyLoading(true);
    setError(null);
    try {
      const result = await invokeTauriCommand<string>("apply_folder_icon", {
        folder_path: activeFolder.folder_path,
        image_path: currentVersion.image_path,
      });
      await reportClientAction(
        session.session_id,
        "apply_icons",
        [
          {
            folder_id: activeFolder.folder_id,
            folder_name: activeFolder.folder_name,
            folder_path: activeFolder.folder_path,
            status: "applied",
            message: result || `已应用图标: ${activeFolder.folder_path}`,
          },
        ],
        [],
      );
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
      const result = await invokeTauriCommand<string>("clear_folder_icon", {
        folder_path: activeFolder.folder_path,
      });
      setRestoreConfirmOpen(false);
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
      const result = await invokeTauriCommand<string>("restore_last_folder_icon", {
        folder_path: activeFolder.folder_path,
      });
      await reportClientAction(
        session.session_id,
        "restore_icons",
        [
          {
            folder_id: activeFolder.folder_id,
            folder_name: activeFolder.folder_name,
            folder_path: activeFolder.folder_path,
            status: "restored",
            message: result || `已恢复最近一次图标状态: ${activeFolder.folder_path}`,
          },
        ],
        [],
      );
      setRestoreLastConfirmOpen(false);
      setNotice(result || "已恢复最近一次图标状态。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "恢复最近一次图标失败。");
    } finally {
      setRestoreLastLoading(false);
    }
  }

  async function handleSaveConfig() {
    setSavingConfig(true);
    setError(null);
    try {
      const nextConfig = await iconApi.updateConfig(configDraft);
      setConfig(nextConfig);
      setConfigDraft(nextConfig);
      setSettingsOpen(false);
      setNotice("图标工坊配置已保存。");
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存图标工坊配置失败。");
    } finally {
      setSavingConfig(false);
    }
  }

  const canApply = isTauriDesktop() && currentVersion?.status === "ready";

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex items-center gap-3 rounded-[16px] border border-on-surface/8 bg-surface-container-lowest px-6 py-4 shadow-[0_18px_48px_rgba(36,48,42,0.08)]">
          <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
          <p className="text-[14px] font-semibold text-on-surface">正在读取图标工坊配置...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-surface xl:flex-row">
      <IconChatPanel
        session={session}
        messageInput={chatInput}
        onMessageInputChange={setChatInput}
        onSendMessage={() => void handleSendMessage()}
        sending={chatLoading}
        actionLoadingId={actionLoadingId}
        onConfirmAction={(action) => void handleConfirmAction(action)}
        onDismissAction={(action) => void handleDismissAction(action)}
        selectedCount={selectedFolderIds.length}
        activeFolderName={activeFolder?.folder_name || null}
        allowClientActions={isTauriDesktop()}
      />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="border-b border-on-surface/8 bg-surface-container-lowest/92 px-4 py-3 backdrop-blur-xl sm:px-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-[14px] border border-primary/12 bg-primary/10 text-primary shadow-[0_12px_28px_rgba(77,99,87,0.12)]">
                <Palette className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-primary/70">Icon Workbench</p>
                <h1 className="truncate text-[20px] font-black tracking-tight text-on-surface">
                  {session ? session.parent_dir.replace(/[\\/]$/, "").split(/[\\/]/).pop() || "图标工坊" : "图标工坊"}
                </h1>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => void chooseParentDirectory()}>
                <FolderOpen className="h-4 w-4" />
                选择父目录
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void handleRescan()} disabled={!session || !!actionLabel}>
                <RefreshCw className={cn("h-4 w-4", actionLabel === "正在刷新子文件夹列表" && "animate-spin")} />
                重新扫描
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(true)}>
                <Settings2 className="h-4 w-4" />
                图标设置
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleApplyReadySelected()}
                disabled={!session || selectedFolderIds.length === 0 || batchApplyLoading || !isTauriDesktop()}
                loading={batchApplyLoading}
              >
                <Sparkles className="h-4 w-4" />
                批量应用已就绪
              </Button>
              <Button variant="primary" size="sm" onClick={() => void handleAnalyzeSelected()} disabled={!session || selectedFolderIds.length === 0 || !!actionLabel}>
                <WandSparkles className="h-4 w-4" />
                分析选中
              </Button>
              <Button variant="primary" size="sm" onClick={() => void handleGenerateSelected()} disabled={!session || selectedFolderIds.length === 0 || !!actionLabel}>
                <ImagePlus className="h-4 w-4" />
                生成预览
              </Button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-ui-muted">
            <span>目录: {session?.parent_dir || "尚未选择"}</span>
            <span>子文件夹: {session?.folder_count || 0}</span>
            <span>就绪版本: {session?.ready_count || 0}</span>
            {actionLabel ? <span className="text-primary">{actionLabel}</span> : null}
          </div>
        </div>

        {error ? (
          <div className="px-4 pt-4 sm:px-5">
            <ErrorAlert title="图标工坊请求失败" message={error} />
          </div>
        ) : null}

        {notice ? (
          <div className="px-4 pt-4 sm:px-5">
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-3 rounded-[16px] border border-primary/12 bg-primary/10 px-4 py-3 text-[13px] text-primary shadow-[0_16px_40px_rgba(77,99,87,0.08)]"
            >
              <Check className="h-4 w-4" />
              <p className="font-medium">{notice}</p>
              <button type="button" className="ml-auto text-primary/60 hover:text-primary" onClick={() => setNotice(null)}>
                关闭
              </button>
            </motion.div>
          </div>
        ) : null}

        {!session ? (
          <div className="flex flex-1 items-center justify-center px-6">
            <EmptyState
              icon={FolderCog}
              title="先选择一个父目录"
              description="图标工坊会扫描这个目录下的一级子文件夹，然后对选中的文件夹生成分析结果和图标预览。"
            >
              <Button variant="primary" size="lg" onClick={() => void chooseParentDirectory()}>
                <FolderOpen className="h-4 w-4" />
                选择父目录
              </Button>
            </EmptyState>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden 2xl:grid-cols-[320px_minmax(0,1.15fr)_420px]">
            <section className="min-h-0 border-r border-on-surface/8 bg-surface-container-lowest/86 px-4 py-4">
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex items-center gap-2 rounded-[12px] border border-on-surface/8 bg-white px-3 py-2.5 shadow-[0_8px_24px_rgba(36,48,42,0.04)]">
                  <Search className="h-4 w-4 text-ui-muted" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="筛选文件夹名称"
                    className="w-full bg-transparent text-[14px] outline-none placeholder:text-ui-muted"
                  />
                </div>

                <div className="mt-4 flex items-center justify-between text-[12px] text-ui-muted">
                  <button
                    type="button"
                    className="font-semibold text-primary hover:text-primary-dim"
                    onClick={() => setSelectedFolderIds(filteredFolders.map((folder) => folder.folder_id))}
                  >
                    当前视图全选
                  </button>
                  <button
                    type="button"
                    className="font-semibold text-ui-muted hover:text-on-surface"
                    onClick={() => setSelectedFolderIds([])}
                  >
                    清空选择
                  </button>
                </div>

                <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-thin">
                  <div className="space-y-2">
                    {filteredFolders.map((folder, index) => {
                      const summary = summarizeFolder(folder);
                      const checked = selectedFolderIds.includes(folder.folder_id);
                      const isActive = activeFolder?.folder_id === folder.folder_id;
                      return (
                        <motion.button
                          key={folder.folder_id}
                          type="button"
                          layout
                          onClick={() => setActiveFolderId(folder.folder_id)}
                          className={cn(
                            "w-full rounded-[16px] border px-3 py-3 text-left transition-all",
                            isActive
                              ? "border-primary/16 bg-white shadow-[0_18px_48px_rgba(36,48,42,0.08)]"
                              : "border-on-surface/8 bg-surface-container-low hover:border-primary/12",
                          )}
                        >
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                const enabled = event.target.checked;
                                setSelectedFolderIds((current) =>
                                  enabled
                                    ? Array.from(new Set([...current, folder.folder_id]))
                                    : current.filter((item) => item !== folder.folder_id),
                                );
                              }}
                              onClick={(event) => event.stopPropagation()}
                              className="mt-1 h-4 w-4 rounded border-outline-variant text-primary focus:ring-primary"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-[11px] uppercase tracking-[0.22em] text-ui-muted">#{String(index + 1).padStart(2, "0")}</p>
                                  <h2 className="truncate text-[15px] font-bold tracking-tight text-on-surface">{folder.folder_name}</h2>
                                </div>
                                <span className={cn("shrink-0 rounded-full border px-2 py-1 text-[11px] font-semibold", statusClassName(summary.tone))}>
                                  {summary.label}
                                </span>
                              </div>
                              <p className="mt-2 line-clamp-2 text-[12px] leading-5 text-ui-muted">
                                {folder.analysis?.summary || folder.last_error || folder.folder_path}
                              </p>
                            </div>
                          </div>
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </section>

            <section className="min-h-0 overflow-y-auto border-r border-on-surface/8 bg-surface px-4 py-4 scrollbar-thin">
              {activeFolder ? (
                <div className="mx-auto flex max-w-3xl flex-col gap-6">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-[22px] border border-on-surface/8 bg-surface-container-lowest p-5 shadow-[0_24px_64px_rgba(36,48,42,0.08)]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-2">
                        <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-primary/75">当前文件夹</p>
                        <h2 className="text-[28px] font-black tracking-tight text-on-surface">{activeFolder.folder_name}</h2>
                        <p className="max-w-2xl text-[14px] leading-7 text-ui-muted">{activeFolder.folder_path}</p>
                      </div>
                      <div className="grid gap-2 text-right text-[12px] text-ui-muted">
                        <span>分析状态: {activeFolder.analysis_status === "ready" ? "已完成" : activeFolder.analysis_status === "error" ? "失败" : "待分析"}</span>
                        <span>版本数: {activeFolder.versions.length}</span>
                        <span>更新时间: {formatDisplayDate(activeFolder.updated_at)}</span>
                      </div>
                    </div>

                    <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                      <div className="space-y-4">
                        <div className="rounded-[16px] border border-on-surface/8 bg-surface px-4 py-4">
                          <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-ui-muted">分析摘要</p>
                          <p className="mt-3 text-[14px] leading-7 text-on-surface">
                            {activeFolder.analysis?.summary || "还没有分析结果。先执行“分析选中”，再根据摘要生成方向。"}
                          </p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-[16px] border border-on-surface/8 bg-surface px-4 py-4">
                            <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-ui-muted">分类</p>
                            <p className="mt-3 text-[18px] font-bold tracking-tight text-on-surface">{activeFolder.analysis?.category || "待分析"}</p>
                          </div>
                          <div className="rounded-[16px] border border-on-surface/8 bg-surface px-4 py-4">
                            <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-ui-muted">视觉主体</p>
                            <p className="mt-3 text-[18px] font-bold tracking-tight text-on-surface">{activeFolder.analysis?.visual_subject || "待分析"}</p>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-[16px] border border-on-surface/8 bg-primary/[0.035] px-4 py-4">
                        <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-primary/70">操作建议</p>
                        <div className="mt-4 space-y-3 text-[13px] leading-6 text-ui-muted">
                          <p>1. 先分析文件夹，确认主题和视觉主体是否准确。</p>
                          <p>2. 再调整提示词，让生成结果更贴近你想要的图标材质和轮廓。</p>
                          <p>3. 生成出满意版本后，在桌面壳里直接应用到 Windows 文件夹。</p>
                        </div>
                      </div>
                    </div>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 }}
                    className="rounded-[22px] border border-on-surface/8 bg-surface-container-lowest p-5 shadow-[0_20px_56px_rgba(36,48,42,0.06)]"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-primary/70">当前提示词</p>
                        <h3 className="mt-1 text-[20px] font-black tracking-tight text-on-surface">图标生成指令</h3>
                      </div>
                      <Button variant="secondary" size="sm" onClick={() => setPromptDraft(activeFolder.analysis?.suggested_prompt || "")}>
                        <Sparkles className="h-4 w-4" />
                        恢复建议稿
                      </Button>
                    </div>

                    <textarea
                      value={promptDraft}
                      onChange={(event) => setPromptDraft(event.target.value)}
                      rows={7}
                      className="mt-4 w-full rounded-[16px] border border-on-surface/8 bg-white px-4 py-3 text-[14px] leading-7 text-on-surface outline-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/6"
                      placeholder="例如：纸质文件夹图标，主体是摄影胶卷，轮廓清晰，适合 Windows 文件夹图标"
                    />

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Button variant="primary" size="sm" onClick={() => void handleSavePrompt()} disabled={!promptDraft.trim() || !!actionLabel}>
                        <Save className="h-4 w-4" />
                        保存提示词
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleGenerateSelected()}
                        disabled={!selectedFolderIds.includes(activeFolder.folder_id) || !!actionLabel}
                      >
                        <ImagePlus className="h-4 w-4" />
                        使用当前选择生成
                      </Button>
                    </div>
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.08 }}
                    className="rounded-[22px] border border-on-surface/8 bg-surface-container-lowest p-5 shadow-[0_20px_56px_rgba(36,48,42,0.06)]"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-primary/70">模板与批量指令</p>
                        <h3 className="mt-1 text-[20px] font-black tracking-tight text-on-surface">模板库</h3>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void reloadTemplates(selectedTemplateId)}
                        disabled={templatesLoading || templateActionLoading}
                      >
                        <RefreshCw className={cn("h-4 w-4", templatesLoading && "animate-spin")} />
                        刷新模板
                      </Button>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto]">
                      <div className="rounded-[14px] border border-on-surface/8 bg-white px-3 py-2.5">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ui-muted">选择模板</p>
                        <select
                          value={selectedTemplateId}
                          onChange={(event) => setSelectedTemplateId(event.target.value)}
                          className="mt-2 w-full bg-transparent text-[14px] text-on-surface outline-none"
                        >
                          {templates.map((template) => (
                            <option key={template.template_id} value={template.template_id}>
                              {template.name} {template.is_builtin ? "（内置）" : "（自定义）"}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => void handleApplyTemplateToSelected()}
                        disabled={!session || !selectedTemplateId || selectedFolderIds.length === 0 || !!actionLabel}
                      >
                        <Sparkles className="h-4 w-4" />
                        套用到选中
                      </Button>
                    </div>

                    {selectedTemplate ? (
                      <p className="mt-3 text-[12px] text-ui-muted">
                        当前模板说明：{selectedTemplate.description || "暂无说明"}
                      </p>
                    ) : null}

                    <div className="mt-4 space-y-3 rounded-[16px] border border-on-surface/8 bg-surface px-4 py-4">
                      <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-primary/70">编辑模板</p>
                      <TextInput value={templateNameDraft} onChange={setTemplateNameDraft} placeholder="模板名称" />
                      <TextInput value={templateDescriptionDraft} onChange={setTemplateDescriptionDraft} placeholder="模板说明（可选）" />
                      <textarea
                        value={templatePromptDraft}
                        onChange={(event) => setTemplatePromptDraft(event.target.value)}
                        rows={4}
                        className="w-full rounded-[12px] border border-on-surface/8 bg-white px-3 py-2.5 text-[14px] leading-6 text-on-surface outline-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/6"
                        placeholder="支持变量：{{subject}}、{{folder_name}}、{{category}}"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setTemplateNameDraft("");
                            setTemplateDescriptionDraft("");
                            setTemplatePromptDraft("");
                          }}
                          disabled={templateActionLoading}
                        >
                          <Plus className="h-4 w-4" />
                          新建草稿
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => void handleCreateTemplate()}
                          disabled={templateActionLoading}
                          loading={templateActionLoading}
                        >
                          <Save className="h-4 w-4" />
                          保存为新模板
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => void handleUpdateTemplate()}
                          disabled={!selectedTemplate || selectedTemplate.is_builtin || templateActionLoading}
                        >
                          <Save className="h-4 w-4" />
                          更新选中模板
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => void handleDeleteTemplate()}
                          disabled={!selectedTemplate || selectedTemplate.is_builtin || templateActionLoading}
                        >
                          <Trash2 className="h-4 w-4" />
                          删除选中模板
                        </Button>
                      </div>
                      {selectedTemplate?.is_builtin ? <p className="text-[12px] text-ui-muted">内置模板不可直接修改或删除，可另存为新模板。</p> : null}
                    </div>
                  </motion.div>
                </div>
              ) : (
                <EmptyState icon={Palette} title="当前没有可查看的文件夹" description="重新选择父目录或调整文件夹筛选条件。" />
              )}
            </section>

            <section className="min-h-0 overflow-y-auto bg-surface-container-lowest/88 px-4 py-4 scrollbar-thin">
              {activeFolder ? (
                <div className="flex h-full flex-col gap-4">
                  <div className="rounded-[22px] border border-on-surface/8 bg-white p-4 shadow-[0_22px_60px_rgba(36,48,42,0.08)]">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-primary/70">当前预览</p>
                        <h3 className="mt-1 text-[20px] font-black tracking-tight text-on-surface">
                          {currentVersion ? `v${currentVersion.version_number}` : "尚未生成"}
                        </h3>
                      </div>
                      <div className="text-right text-[12px] text-ui-muted">
                        <p>桌面应用: {isTauriDesktop() ? "已连接" : "当前为浏览器模式"}</p>
                        <p>应用操作仅在桌面壳内可用</p>
                      </div>
                    </div>

                    <div className="mt-4 overflow-hidden rounded-[20px] border border-on-surface/8 bg-[linear-gradient(145deg,rgba(77,99,87,0.08),rgba(255,255,255,0.6))]">
                      {currentVersion && currentVersion.status === "ready" ? (
                        <img
                          src={buildImageSrc(currentVersion, baseUrl, apiToken)}
                          alt={`${activeFolder.folder_name} preview`}
                          className="aspect-square w-full object-cover"
                        />
                      ) : (
                        <div className="flex aspect-square items-center justify-center">
                          <div className="space-y-3 text-center">
                            <BrushCleaning className="mx-auto h-10 w-10 text-primary/45" />
                            <p className="text-[13px] font-medium text-ui-muted">生成版本后，这里会显示当前预览。</p>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button variant="primary" size="sm" onClick={() => void handleApplyCurrentVersion()} disabled={!canApply} loading={applyLoading}>
                        <Sparkles className="h-4 w-4" />
                        应用到文件夹
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setRestoreLastConfirmOpen(true)}
                        disabled={!activeFolder || !isTauriDesktop() || !canRestoreCurrentFolder}
                        loading={restoreLastLoading}
                      >
                        <RefreshCw className="h-4 w-4" />
                        恢复最近一次
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => setRestoreConfirmOpen(true)} disabled={!activeFolder || !isTauriDesktop()}>
                        <BrushCleaning className="h-4 w-4" />
                        恢复默认图标
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => void systemApi.openDir(activeFolder.folder_path)}>
                        <FolderOpen className="h-4 w-4" />
                        打开目录
                      </Button>
                    </div>
                  </div>

                  {batchApplyReport ? (
                    <div className="rounded-[22px] border border-on-surface/8 bg-white p-4 shadow-[0_16px_40px_rgba(36,48,42,0.06)]">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-primary/70">批量应用结果</p>
                          <h3 className="mt-1 text-[20px] font-black tracking-tight text-on-surface">最近一次执行</h3>
                        </div>
                        <button
                          type="button"
                          className="text-[12px] font-semibold text-ui-muted hover:text-on-surface"
                          onClick={() => setBatchApplyReport(null)}
                        >
                          清空
                        </button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[12px] text-ui-muted">
                        <span>总计: {batchApplyReport.total}</span>
                        <span className="text-primary">成功: {batchApplyReport.applied}</span>
                        <span className={batchApplyReport.failed > 0 ? "text-error" : ""}>失败: {batchApplyReport.failed}</span>
                        <span>跳过: {batchApplyReport.skipped}</span>
                      </div>
                      <div className="mt-3 max-h-48 space-y-2 overflow-y-auto pr-1 text-[12px] scrollbar-thin">
                        {batchApplyReport.results.map((item) => (
                          <div key={`${item.folder_path}-${item.status}`} className="rounded-[10px] border border-on-surface/8 bg-surface-container-low px-3 py-2">
                            <p className={cn("font-semibold", item.status === "applied" ? "text-primary" : "text-error")}>
                              {item.folder_name || item.folder_path}
                            </p>
                            <p className="mt-1 text-ui-muted">{item.message}</p>
                          </div>
                        ))}
                        {batchApplyReport.skipped_items.map((item) => (
                          <div key={`${item.folder_id}-${item.status}`} className="rounded-[10px] border border-on-surface/8 bg-surface-container-low px-3 py-2">
                            <p className="font-semibold text-ui-muted">{item.folder_name}（跳过）</p>
                            <p className="mt-1 text-ui-muted">{item.message}</p>
                          </div>
                        ))}
                        {batchApplyReport.results.length === 0 && batchApplyReport.skipped_items.length === 0 ? (
                          <p className="text-ui-muted">没有可显示的结果。</p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <div className="min-h-0 flex-1 rounded-[22px] border border-on-surface/8 bg-white p-4 shadow-[0_16px_40px_rgba(36,48,42,0.06)]">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-primary/70">版本列表</p>
                        <h3 className="mt-1 text-[20px] font-black tracking-tight text-on-surface">候选预览</h3>
                      </div>
                      <p className="text-[12px] text-ui-muted">{activeFolder.versions.length} 个版本</p>
                    </div>

                    <div className="mt-4 grid gap-3">
                      <AnimatePresence initial={false}>
                        {activeFolder.versions.map((version) => {
                          const isCurrent = version.version_id === activeFolder.current_version_id;
                          return (
                            <motion.button
                              key={version.version_id}
                              layout
                              initial={{ opacity: 0, y: 8 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -8 }}
                              type="button"
                              onClick={() => void handleSelectVersion(version.version_id)}
                              className={cn(
                                "flex items-center gap-3 rounded-[16px] border p-3 text-left transition-all",
                                isCurrent ? "border-primary/16 bg-primary/6" : "border-on-surface/8 bg-surface-container-lowest hover:border-primary/12",
                              )}
                            >
                              <div className="h-16 w-16 overflow-hidden rounded-[14px] border border-on-surface/8 bg-surface">
                                {version.status === "ready" ? (
                                  <img
                                    src={buildImageSrc(version, baseUrl, apiToken)}
                                    alt={`version-${version.version_number}`}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center text-error">
                                    <BrushCleaning className="h-5 w-5" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-3">
                                  <p className="text-[15px] font-bold tracking-tight text-on-surface">v{version.version_number}</p>
                                  <span className={cn("rounded-full border px-2 py-1 text-[11px] font-semibold", statusClassName(version.status === "ready" ? "success" : "error"))}>
                                    {version.status === "ready" ? "就绪" : "失败"}
                                  </span>
                                </div>
                                <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-ui-muted">{version.error_message || version.prompt}</p>
                              </div>
                            </motion.button>
                          );
                        })}
                      </AnimatePresence>
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyState icon={ImagePlus} title="还没有预览内容" description="先在文件夹列表里选中一个目录，再分析和生成预览。" />
              )}
            </section>
          </div>
        )}
      </div>

      <AnimatePresence>
        {settingsOpen ? (
          <div className="fixed inset-0 z-[80] flex justify-end bg-surface/55 backdrop-blur-sm" onClick={() => setSettingsOpen(false)}>
            <motion.aside
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.18 }}
              className="flex h-full w-full max-w-[520px] flex-col border-l border-on-surface/8 bg-surface-container-lowest shadow-[0_30px_90px_rgba(36,48,42,0.18)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="border-b border-on-surface/8 px-5 py-4">
                <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-primary/70">图标工坊配置</p>
                <h2 className="mt-1 text-[24px] font-black tracking-tight text-on-surface">模型与生成参数</h2>
                <p className="mt-2 text-[13px] leading-6 text-ui-muted">文本模型负责目录语义提炼，图像模型负责产出 PNG 预览。这里不会改动现有整理主链的设置。</p>
              </div>

              <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5 scrollbar-thin">
                <section className="space-y-4 rounded-[18px] border border-on-surface/8 bg-white p-4 shadow-[0_18px_40px_rgba(36,48,42,0.05)]">
                  <div>
                    <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-primary/70">文本分析模型</p>
                    <h3 className="mt-1 text-[18px] font-black tracking-tight text-on-surface">目录理解</h3>
                  </div>
                  <FieldShell label="接口地址" hint="可填 base URL 或完整 chat/completions 地址">
                    <TextInput
                      value={configDraft.text_model.base_url}
                      onChange={(value) => setConfigDraft((current) => ({ ...current, text_model: { ...current.text_model, base_url: value } }))}
                      placeholder="https://api.openai.com/v1"
                    />
                  </FieldShell>
                  <FieldShell label="模型 ID">
                    <TextInput
                      value={configDraft.text_model.model}
                      onChange={(value) => setConfigDraft((current) => ({ ...current, text_model: { ...current.text_model, model: value } }))}
                      placeholder="gpt-5.2"
                    />
                  </FieldShell>
                  <FieldShell label="API 密钥">
                    <div className="flex items-center gap-2 rounded-[10px] border border-on-surface/8 bg-white px-2">
                      <input
                        type={showTextSecret ? "text" : "password"}
                        value={configDraft.text_model.api_key}
                        onChange={(event) => setConfigDraft((current) => ({ ...current, text_model: { ...current.text_model, api_key: event.target.value } }))}
                        placeholder="sk-..."
                        className="w-full bg-transparent px-2 py-2.5 text-[14px] outline-none"
                      />
                      <TogglePasswordButton visible={showTextSecret} onToggle={() => setShowTextSecret((value) => !value)} />
                    </div>
                  </FieldShell>
                </section>

                <section className="space-y-4 rounded-[18px] border border-on-surface/8 bg-white p-4 shadow-[0_18px_40px_rgba(36,48,42,0.05)]">
                  <div>
                    <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-primary/70">图像生成模型</p>
                    <h3 className="mt-1 text-[18px] font-black tracking-tight text-on-surface">预览输出</h3>
                  </div>
                  <FieldShell label="接口地址" hint="可填 base URL 或完整 images/generations 地址">
                    <TextInput
                      value={configDraft.image_model.base_url}
                      onChange={(value) => setConfigDraft((current) => ({ ...current, image_model: { ...current.image_model, base_url: value } }))}
                      placeholder="https://api.openai.com/v1"
                    />
                  </FieldShell>
                  <FieldShell label="模型 ID">
                    <TextInput
                      value={configDraft.image_model.model}
                      onChange={(value) => setConfigDraft((current) => ({ ...current, image_model: { ...current.image_model, model: value } }))}
                      placeholder="gpt-image-1"
                    />
                  </FieldShell>
                  <FieldShell label="API 密钥">
                    <div className="flex items-center gap-2 rounded-[10px] border border-on-surface/8 bg-white px-2">
                      <input
                        type={showImageSecret ? "text" : "password"}
                        value={configDraft.image_model.api_key}
                        onChange={(event) => setConfigDraft((current) => ({ ...current, image_model: { ...current.image_model, api_key: event.target.value } }))}
                        placeholder="sk-..."
                        className="w-full bg-transparent px-2 py-2.5 text-[14px] outline-none"
                      />
                      <TogglePasswordButton visible={showImageSecret} onToggle={() => setShowImageSecret((value) => !value)} />
                    </div>
                  </FieldShell>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FieldShell label="图像尺寸">
                      <TextInput
                        value={configDraft.image_size}
                        onChange={(value) => setConfigDraft((current) => ({ ...current, image_size: value }))}
                        placeholder="1024x1024"
                      />
                    </FieldShell>
                    <FieldShell label="并发数" hint="一期默认按顺序执行，先保留配置位">
                      <TextInput
                        value={configDraft.concurrency_limit}
                        onChange={(value) => setConfigDraft((current) => ({ ...current, concurrency_limit: Number(value) || 1 }))}
                        type="number"
                      />
                    </FieldShell>
                  </div>
                </section>
              </div>

              <div className="border-t border-on-surface/8 px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] text-ui-muted">当前文本模型：{config.text_model.model || "未配置"} / 当前图像模型：{config.image_model.model || "未配置"}</p>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(false)} disabled={savingConfig}>
                      取消
                    </Button>
                    <Button variant="primary" size="sm" onClick={() => void handleSaveConfig()} loading={savingConfig}>
                      保存配置
                    </Button>
                  </div>
                </div>
              </div>
            </motion.aside>
          </div>
        ) : null}
      </AnimatePresence>

      <ConfirmDialog
        open={restoreConfirmOpen}
        title="恢复系统默认图标"
        description={`会移除 ${activeFolder?.folder_name || "当前文件夹"} 的自定义图标并请求 Explorer 刷新显示。`}
        confirmLabel="确认恢复"
        cancelLabel="取消"
        onConfirm={() => void handleRestoreDefaultIcon()}
        onCancel={() => setRestoreConfirmOpen(false)}
        loading={applyLoading}
      />
      <ConfirmDialog
        open={restoreLastConfirmOpen}
        title="恢复最近一次图标状态"
        description={`会把 ${activeFolder?.folder_name || "当前文件夹"} 恢复到最近一次应用前的图标状态，并刷新 Explorer 显示。`}
        confirmLabel="确认恢复"
        cancelLabel="取消"
        onConfirm={() => void handleRestoreLastIcon()}
        onCancel={() => setRestoreLastConfirmOpen(false)}
        loading={restoreLastLoading}
      />
    </div>
  );
}
