"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Check,
  CheckCircle2,
  AlertCircle,
  FileText,
  FolderOpen,
  History,
  Layers3,
  ListTree,
  Plus,
  Loader2,
  Sparkles,
  Trash2,
  Upload,
  FolderPlus,
  FilePlus,
  LogOut,
  ChevronDown,
  ShieldAlert,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { createApiClient } from "@/lib/api";
import {
  firstSourcePath,
  createLaunchSession,
  startFreshSession,
} from "@/lib/session-launcher-actions";
import {
  getApiBaseUrl,
  getApiToken,
  inspectPathsWithTauri,
  isTauriDesktop,
  listDirectoryEntriesResultWithTauri,
  pickDirectoriesWithTauri,
  pickDirectoryWithTauri,
  pickFilesWithTauri,
} from "@/lib/runtime";
import {
  findDropZoneForPosition,
  isTauriDragDropPayload,
  isTauriDragLeavePayload,
  isTauriDragOverPayload,
  listenToTauriDragDrop,
} from "@/lib/tauri-drag-drop";
import { getSessionStageView } from "@/lib/session-view-model";
import { deriveWorkspaceRoot } from "@/lib/path-normalization";
import { buildWorkspaceRoute, getWorkspaceRouteForHistoryEntry, getWorkspaceRouteForSnapshot } from "@/lib/workspace-routes";
import {
  buildStrategySummary,
  CAUTION_LEVEL_OPTIONS,
  DEFAULT_STRATEGY_SELECTION,
  DENSITY_OPTIONS,
  getLaunchStrategyFromConfig,
  getSuggestedSelection,
  getTemplateMeta,
  LANGUAGE_OPTIONS,
  PREFIX_STYLE_OPTIONS,
  shouldSkipLaunchStrategyPrompt,
  STRATEGY_TEMPLATES,
} from "@/lib/strategy-templates";
import { cn, formatDisplayDate, getFriendlyStage, getFriendlyStatus } from "@/lib/utils";
import type {
  DirectorySourceMode,
  LaunchStrategyConfig,
  OrganizeMethod,
  SessionSnapshot,
  SessionSourceSelection,
  SessionStrategySelection,
  SessionStrategySummary,
  TargetProfile,
  TargetProfileDirectory,
  HistoryItem,
} from "@/types/session";
import { ErrorAlert } from "@/components/ui/error-alert";
import { ModelConfigBanner } from "@/components/ui/model-config-banner";
import { Button } from "@/components/ui/button";
import { DropZoneOverlay, getDropZoneSurfaceClassName } from "@/components/ui/drop-zone-feedback";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LaunchTransitionOverlay } from "./launcher/launch-transition-overlay";
import { ResumePromptDialog } from "./launcher/resume-prompt-dialog";

type SourceDraftType = "directory" | "file";

type TargetDirectoryDraft = {
  path: string;
  label: string;
  description: string;
};

type SourceImportGroup = {
  group_id: string;
  source_path: string;
  item_keys: string[];
  expanded: boolean;
};

type SourceFeedback = {
  tone: "success" | "info";
  message: string;
};

type LaunchWorkbenchTask = {
  route: string;
  sessionId: string | null;
};

const LAUNCH_TRANSITION_TIMEOUT_MS = 20000;

type LaunchRequestState = {
  sources: SessionSourceSelection[];
  resume_if_exists: boolean;
  organize_method: OrganizeMethod;
  strategy: SessionStrategySelection;
  output_dir?: string;
  target_profile_id?: string;
  target_directories?: string[];
  target_directory_details?: TargetProfileDirectory[];
  new_directory_root?: string;
  review_root?: string;
  display_path: string;
};

type LauncherDraftState = {
  version: 1;
  step?: 1 | 2 | 3;
  strategy?: SessionStrategySelection;
  sources?: SessionSourceSelection[];
  sourceImportGroups?: SourceImportGroup[];
  sourceDraftType?: SourceDraftType;
  sourceDraftPath?: string;
  newDirectoryRoot?: string;
  reviewRoot?: string;
  reviewFollowsNewRoot?: boolean;
  showPlacementOverrides?: boolean;
  manualTargetDirectories?: TargetDirectoryDraft[];
  targetDirectoryDraft?: string;
  selectedTargetProfileId?: string;
  showManualInput?: boolean;
  showManualTargetInput?: boolean;
};

const IMPORT_GROUP_PREVIEW_LIMIT = 5;
const LAUNCHER_DRAFT_KEY = "file_pilot_launcher_draft";
const ACTIVE_WORKSPACE_ROUTE_KEY = "workspace_active_route";
const APP_CONTEXT_EVENT = "file-pilot-context-change";
const FINAL_HISTORY_STATUSES = new Set(["success", "completed", "partial_failure", "rolled_back", "rollback_partial_failure"]);

function createImportGroupId(): string {
  return `import-group:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeDirectoryMode(item: Pick<SessionSourceSelection, "source_type" | "directory_mode">): DirectorySourceMode {
  if (item.source_type !== "directory") {
    return "atomic";
  }
  return item.directory_mode === "atomic" ? "atomic" : "contents";
}

function createDirectorySource(path: string, directoryMode: DirectorySourceMode = "atomic"): SessionSourceSelection {
  return {
    source_type: "directory",
    path,
    directory_mode: directoryMode,
  };
}

function pathKey(path: string): string {
  let normalized = String(path || "").trim().replace(/\\/g, "/");
  normalized = normalized.replace(/\/+/g, "/");
  while (normalized.length > 1 && normalized.endsWith("/") && !/^[a-z]:\/$/i.test(normalized)) {
    normalized = normalized.slice(0, -1);
  }
  return normalized.toLowerCase();
}

function targetDirectoryEditorKey(path: string): string {
  return `target:${pathKey(path)}`;
}

function sourceSelectionKey(item: Pick<SessionSourceSelection, "source_type" | "path">): string {
  return `${item.source_type}:${pathKey(item.path)}`;
}

function normalizeSourceSelection(item: SessionSourceSelection): SessionSourceSelection | null {
  const path = item.path.trim();
  if (!path) {
    return null;
  }
  if (item.source_type === "directory") {
    return createDirectorySource(path, normalizeDirectoryMode(item));
  }
  if (item.source_type === "file") {
    return { source_type: "file", path };
  }
  return null;
}

function dedupeSources(items: SessionSourceSelection[]): SessionSourceSelection[] {
  const seen = new Map<string, SessionSourceSelection>();
  for (const item of items) {
    const normalized = normalizeSourceSelection(item);
    if (!normalized) continue;
    const key = sourceSelectionKey(normalized);
    if (seen.has(key)) {
      seen.delete(key);
    }
    seen.set(key, normalized);
  }
  return Array.from(seen.values());
}

function sourceDisplayName(item: Pick<SessionSourceSelection, "path">): string {
  return item.path.split(/[\\/]/).pop() || item.path;
}

function compareSourceForDisplay(a: SessionSourceSelection, b: SessionSourceSelection): number {
  if (a.source_type !== b.source_type) {
    return a.source_type === "directory" ? -1 : 1;
  }
  return sourceDisplayName(a).localeCompare(sourceDisplayName(b), "zh-Hans-CN", {
    numeric: true,
    sensitivity: "base",
  });
}

function sortSourcesForDisplay(items: SessionSourceSelection[]): SessionSourceSelection[] {
  return [...items].sort(compareSourceForDisplay);
}

function readLauncherDraft(): LauncherDraftState | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(LAUNCHER_DRAFT_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as LauncherDraftState;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function sanitizeLauncherDraft(draft: LauncherDraftState | null): LauncherDraftState | null {
  if (!draft) {
    return null;
  }
  const sources = dedupeSources(draft.sources || []);
  const sourceKeys = new Set(sources.map((item) => sourceSelectionKey(item)));
  return {
    ...draft,
    step: draft.step === 2 || draft.step === 3 ? draft.step : 1,
    sources,
    sourceImportGroups: (draft.sourceImportGroups || [])
      .map((group) => ({
        ...group,
        item_keys: group.item_keys.filter((key) => sourceKeys.has(key)),
        expanded: Boolean(group.expanded),
      }))
      .filter((group) => group.item_keys.length > 0),
    sourceDraftType: draft.sourceDraftType === "file" ? "file" : "directory",
    sourceDraftPath: draft.sourceDraftPath || "",
    manualTargetDirectories: (draft.manualTargetDirectories || []).filter((item) => item.path.trim()),
    targetDirectoryDraft: draft.targetDirectoryDraft || "",
    selectedTargetProfileId: draft.selectedTargetProfileId || "",
    showManualInput: Boolean(draft.showManualInput),
    showManualTargetInput: Boolean(draft.showManualTargetInput),
    showPlacementOverrides: Boolean(draft.showPlacementOverrides),
  };
}

function clearLauncherDraft() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(LAUNCHER_DRAFT_KEY);
}

function rememberWorkspaceRoute(route: string) {
  if (typeof window === "undefined") {
    return;
  }
  const [pathname, search = ""] = route.split("?");
  const params = new URLSearchParams(search);
  params.delete("auto_scan");
  const normalizedRoute = params.toString() ? `${pathname}?${params.toString()}` : pathname;
  window.localStorage.setItem(ACTIVE_WORKSPACE_ROUTE_KEY, normalizedRoute);
  window.dispatchEvent(new Event(APP_CONTEXT_EVENT));
}

function readActiveWorkspaceTask(): LaunchWorkbenchTask | null {
  if (typeof window === "undefined") {
    return null;
  }
  const route = window.localStorage.getItem(ACTIVE_WORKSPACE_ROUTE_KEY);
  if (!route?.startsWith("/workspace")) {
    return null;
  }
  const query = route.split("?")[1] || "";
  const sessionId = new URLSearchParams(query).get("session_id");
  return {
    route,
    sessionId,
  };
}

function getHistoryRoute(entry: HistoryItem, options?: { readonly?: boolean }) {
  return getWorkspaceRouteForHistoryEntry({
    sessionId: entry.execution_id,
    targetDir: entry.target_dir,
    status: entry.status,
    itemCount: entry.item_count,
    readonly: options?.readonly,
  });
}

function isHistorySessionLike(entry: HistoryItem): boolean {
  return Boolean(entry.is_session) || !FINAL_HISTORY_STATUSES.has(String(entry.status || "").toLowerCase());
}

function getHistoryActionLabel(entry: HistoryItem): string {
  if (isHistorySessionLike(entry)) {
    const status = String(entry.status || "").toLowerCase();
    if (status === "draft" || status === "idle") {
      return "继续并扫描";
    }
    if (status === "interrupted" || status === "stale") {
      return "恢复处理";
    }
    return "继续任务";
  }
  return "查看记录";
}

function getHistoryStatusLabel(entry: HistoryItem): string {
  return isHistorySessionLike(entry) ? getFriendlyStage(entry.status) : getFriendlyStatus(entry.status);
}

function getHistoryDisplayName(entry: HistoryItem): string {
  return entry.target_dir.replace(/[\\/]$/, "").split(/[\\/]/).pop() || "未命名任务";
}

function dedupeTargetDirectories(items: TargetProfileDirectory[]): TargetProfileDirectory[] {
  const seen = new Map<string, TargetProfileDirectory>();
  for (const item of items) {
    const path = item.path.trim();
    if (!path) continue;
    const key = pathKey(path);
    if (seen.has(key)) {
      seen.delete(key);
    }
    seen.set(key, {
      path,
      label: item.label?.trim() || "",
      description: item.description?.trim() || "",
    });
  }
  return Array.from(seen.values());
}

function strategyForMethod(previous: SessionStrategySelection, organizeMethod: OrganizeMethod): SessionStrategySelection {
  if (organizeMethod === "assign_into_existing_categories") {
    return {
      ...previous,
      organize_mode: "incremental",
      task_type: "organize_into_existing",
      organize_method: organizeMethod,
    };
  }
  return {
    ...previous,
    organize_mode: "initial",
    task_type: "organize_full_directory",
    organize_method: organizeMethod,
  };
}

function inferDropSourceType(path: string, entry: { isDirectory?: boolean; isFile?: boolean } | null): SourceDraftType {
  if (entry?.isDirectory) return "directory";
  if (entry?.isFile) return "file";
  return /\.[^./\\]+$/.test(path) ? "file" : "directory";
}

function extractDroppedSources(dataTransfer: DataTransfer): SessionSourceSelection[] {
  const result: SessionSourceSelection[] = [];
  const items = Array.from(dataTransfer.items || []);
  const fallbackFiles = Array.from(dataTransfer.files || []);

  for (const item of items) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory?: boolean; isFile?: boolean } | null }).webkitGetAsEntry?.() || null;
    const path = String((file as File & { path?: string }).path || "");
    if (!path) continue;
    result.push({
      ...(inferDropSourceType(path, entry) === "file"
        ? ({ source_type: "file", path } as SessionSourceSelection)
        : createDirectorySource(path, "atomic")),
    });
  }

  if (!result.length) {
    for (const file of fallbackFiles) {
      const path = String((file as File & { path?: string }).path || "");
      if (!path) continue;
      result.push(
        /\.[^./\\]+$/.test(path)
          ? { source_type: "file", path }
          : createDirectorySource(path, "atomic"),
      );
    }
  }

  return dedupeSources(result);
}

function inferSourceSelectionsFromPaths(paths: string[]): SessionSourceSelection[] {
  return dedupeSources(
    paths.map((path) => (
      /\.[^./\\]+$/.test(path)
        ? ({ source_type: "file", path } as SessionSourceSelection)
        : createDirectorySource(path, "atomic")
    )),
  );
}

function sourceSelectionFromDraft(path: string, draftType: SourceDraftType): SessionSourceSelection {
  if (draftType === "file") {
    return { source_type: "file", path };
  }
  return createDirectorySource(path, "atomic");
}

function getSourceBehaviorLabel(item: SessionSourceSelection): string {
  if (item.source_type === "file") {
    return "单个文件";
  }
  return normalizeDirectoryMode(item) === "atomic" ? "整体移动" : "整理里面内容";
}

function getSourceBehaviorHint(item: SessionSourceSelection): string {
  if (item.source_type === "file") {
    return "按单个文件处理。";
  }
  return normalizeDirectoryMode(item) === "atomic"
    ? "将把这个文件夹整体作为一个项目移动。"
    : "将整理这个文件夹里的内容。";
}

function mapDirectoryEntryToSource(entry: { path: string; is_dir: boolean; is_file: boolean }): SessionSourceSelection | null {
  const path = String(entry.path || "").trim();
  if (!path) return null;
  if (entry.is_dir) {
    return createDirectorySource(path, "atomic");
  }
  if (entry.is_file) {
    return { source_type: "file", path };
  }
  return null;
}

function placementDefaults(
  config: LaunchStrategyConfig | null,
  options: {
    organizeMethod: OrganizeMethod;
    outputDir: string;
    sources: SessionSourceSelection[];
  },
) {
  const globalNewDirectoryRoot = String(config?.LAUNCH_DEFAULT_NEW_DIRECTORY_ROOT || "").trim();
  const globalReviewRoot = String(config?.LAUNCH_DEFAULT_REVIEW_ROOT || "").trim();
  const reviewFollowsNewRoot = config?.LAUNCH_REVIEW_FOLLOWS_NEW_ROOT !== false;
  const derivedWorkspaceRoot = deriveWorkspaceRoot(options.sources);
  const fallbackNewDirectoryRoot =
    options.organizeMethod === "categorize_into_new_structure"
      ? (options.outputDir.trim() || derivedWorkspaceRoot)
      : derivedWorkspaceRoot;

  return {
    globalNewDirectoryRoot,
    globalReviewRoot,
    reviewFollowsNewRoot,
    defaultNewDirectoryRoot: globalNewDirectoryRoot || fallbackNewDirectoryRoot,
  };
}

export function SessionLauncherShell() {
  const router = useRouter();
  const pathname = usePathname();
  const apiBaseUrl = getApiBaseUrl();
  const launcherDraftRef = useRef<LauncherDraftState | null>(null);
  const [draftHydrated, setDraftHydrated] = useState(false);

  const launcherDraft = launcherDraftRef.current || null;

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [launchFlowOpen, setLaunchFlowOpen] = useState(false);
  const [strategy, setStrategy] = useState<SessionStrategySelection>(DEFAULT_STRATEGY_SELECTION);
  const [launchConfig, setLaunchConfig] = useState<LaunchStrategyConfig | null>(null);
  const [sources, setSources] = useState<SessionSourceSelection[]>([]);
  const [sourceImportGroups, setSourceImportGroups] = useState<SourceImportGroup[]>([]);
  const [sourceFeedback, setSourceFeedback] = useState<SourceFeedback | null>(null);
  const [sourceDraftType, setSourceDraftType] = useState<SourceDraftType>("directory");
  const [sourceDraftPath, setSourceDraftPath] = useState("");
  const [newDirectoryRoot, setNewDirectoryRoot] = useState("");
  const [reviewRoot, setReviewRoot] = useState("");
  const [reviewFollowsNewRoot, setReviewFollowsNewRoot] = useState(true);
  const [showPlacementOverrides, setShowPlacementOverrides] = useState(false);
  const [advancedSettingsDialogOpen, setAdvancedSettingsDialogOpen] = useState(false);
  const [manualTargetDirectories, setManualTargetDirectories] = useState<TargetDirectoryDraft[]>([]);
  const [expandedTargetDirectoryEditors, setExpandedTargetDirectoryEditors] = useState<Record<string, boolean>>({});
  const [targetDirectoryDraft, setTargetDirectoryDraft] = useState("");
  const [selectedTargetProfileId, setSelectedTargetProfileId] = useState("");
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [targetProfiles, setTargetProfiles] = useState<TargetProfile[]>([]);
  const [targetProfilesLoading, setTargetProfilesLoading] = useState(false);
  const [textModelConfigured, setTextModelConfigured] = useState(true);
  const [loading, setLoading] = useState(false);
  const [launchTransitionOpen, setLaunchTransitionOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showManualInput, setShowManualInput] = useState(false);
  const [showManualTargetInput, setShowManualTargetInput] = useState(false);
  const [resumePrompt, setResumePrompt] = useState<{ sessionId: string; snapshot: SessionSnapshot; launch: LaunchRequestState } | null>(null);
  const [commonDirs, setCommonDirs] = useState<{ label: string; path: string }[]>([]);
  const [recentHistory, setRecentHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeWorkspaceTask, setActiveWorkspaceTask] = useState<LaunchWorkbenchTask | null>(null);
  const [isDropActive, setIsDropActive] = useState(false);
  const [isTargetDropActive, setIsTargetDropActive] = useState(false);
  const [isDraggingGlobal, setIsDraggingGlobal] = useState(false);
  const [isDesktopEnvironment, setIsDesktopEnvironment] = useState(false);
  const [isSourceDropdownOpen, setIsSourceDropdownOpen] = useState(false);
  const sourceDropZoneRef = useRef<HTMLDivElement | null>(null);
  const targetDropZoneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!launchTransitionOpen) {
      return;
    }
    if (pathname !== "/") {
      setLaunchTransitionOpen(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setLaunchTransitionOpen(false);
      setLoading(false);
      setError("打开工作区等待时间过长。任务可能已经创建成功，你可以从左侧“当前任务”继续进入；如果没有看到当前任务，请重试。");
    }, LAUNCH_TRANSITION_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [launchTransitionOpen, pathname]);

  const pruneImportGroups = useCallback(
    (groups: SourceImportGroup[], nextSources: SessionSourceSelection[]): SourceImportGroup[] => {
      const nextKeys = new Set(nextSources.map((item) => sourceSelectionKey(item)));
      return groups
        .map((group) => ({
          ...group,
          item_keys: group.item_keys.filter((key) => nextKeys.has(key)),
        }))
        .filter((group) => group.item_keys.length > 0);
    },
    [],
  );

  const organizeMethod = strategy.organize_method || "categorize_into_new_structure";
  const isAssignExisting = organizeMethod === "assign_into_existing_categories";
  const isFullCategorize = !isAssignExisting;

  const placementConfig = useMemo(
    () =>
      placementDefaults(launchConfig, {
        organizeMethod,
        outputDir: "",
        sources,
      }),
    [launchConfig, organizeMethod, sources],
  );

  const effectiveNewDirectoryRoot = useMemo(() => {
    const override = newDirectoryRoot.trim();
    if (override) return override;
    return placementConfig.defaultNewDirectoryRoot;
  }, [newDirectoryRoot, placementConfig.defaultNewDirectoryRoot]);

  const derivedReviewRoot = useMemo(() => {
    if (!effectiveNewDirectoryRoot) return "";
    return `${effectiveNewDirectoryRoot.replace(/[\\/]$/, "")}/Review`;
  }, [effectiveNewDirectoryRoot]);

  const effectiveReviewRoot = useMemo(() => {
    if (reviewFollowsNewRoot) {
      return derivedReviewRoot;
    }
    const override = reviewRoot.trim();
    if (override) return override;
    if (placementConfig.globalReviewRoot) return placementConfig.globalReviewRoot;
    return derivedReviewRoot;
  }, [derivedReviewRoot, placementConfig.globalReviewRoot, reviewFollowsNewRoot, reviewRoot]);

  const effectiveOutputDir = useMemo(
    () => (isFullCategorize ? effectiveNewDirectoryRoot : ""),
    [effectiveNewDirectoryRoot, isFullCategorize],
  );

  const selectedProfile = useMemo(
    () => targetProfiles.find((item) => item.profile_id === selectedTargetProfileId) || null,
    [selectedTargetProfileId, targetProfiles],
  );
  const profileDirectories = selectedProfile?.directories || [];
  const effectiveTargetDirectories = useMemo(
    () =>
      dedupeTargetDirectories([
        ...profileDirectories,
        ...manualTargetDirectories.map((item) => ({
          path: item.path,
          label: item.label,
          description: item.description,
        })),
      ]),
    [manualTargetDirectories, profileDirectories],
  );
  const sourceKeyMap = useMemo(
    () => new Map(sources.map((item) => [sourceSelectionKey(item), item])),
    [sources],
  );
  const sourceStats = useMemo(() => {
    const directoryCount = sources.filter((item) => item.source_type === "directory").length;
    return {
      total: sources.length,
      directoryCount,
      fileCount: sources.length - directoryCount,
    };
  }, [sources]);
  const displaySources = useMemo(() => sortSourcesForDisplay(sources), [sources]);
  const sourceImportGroupViews = useMemo(
    () =>
      sourceImportGroups
        .map((group) => {
          const items = sortSourcesForDisplay(
            group.item_keys
              .map((key) => sourceKeyMap.get(key))
              .filter((item): item is SessionSourceSelection => Boolean(item)),
          );
          return {
            ...group,
            item_keys: items.map((item) => sourceSelectionKey(item)),
            items,
          };
        })
        .filter((group) => group.items.length > 0),
    [sourceImportGroups, sourceKeyMap],
  );
  const sourceImportGroupByKey = useMemo(() => {
    const mapping = new Map<string, SourceImportGroup & { items: SessionSourceSelection[] }>();
    for (const group of sourceImportGroupViews) {
      for (const key of group.item_keys) {
        mapping.set(key, group);
      }
    }
    return mapping;
  }, [sourceImportGroupViews]);

  const currentSummary = useMemo(
    () =>
      buildStrategySummary({
        ...strategy,
        organize_method: organizeMethod,
        output_dir: effectiveOutputDir || undefined,
        target_profile_id: selectedTargetProfileId || undefined,
        target_directory_details: isAssignExisting ? effectiveTargetDirectories : undefined,
        new_directory_root: effectiveNewDirectoryRoot || undefined,
        review_root: effectiveReviewRoot || undefined,
      }),
    [effectiveNewDirectoryRoot, effectiveOutputDir, effectiveReviewRoot, effectiveTargetDirectories, isAssignExisting, organizeMethod, selectedTargetProfileId, strategy],
  );

  const currentTemplate = getTemplateMeta(strategy.template_id);
  const resumeStrategy = resumePrompt?.snapshot.strategy || currentSummary;
  const resumeStage = resumePrompt?.snapshot.stage;
  const resumeStageView = useMemo(
    () => (resumeStage ? getSessionStageView(resumeStage) : null),
    [resumeStage],
  );
  const isCompletedResume = Boolean(resumeStageView?.isCompleted);
  const skipStrategyPrompt = shouldSkipLaunchStrategyPrompt(launchConfig);
  const stepItems = skipStrategyPrompt
    ? [{ id: 1 as const, title: "选择整理来源" }]
    : [
      { id: 1 as const, title: "选择整理来源" },
      { id: 2 as const, title: "决定整理方式" },
      { id: 3 as const, title: "填写必要信息" },
    ];
  const primaryLaunchLabel = isAssignExisting ? "读取目录并开始规划" : "读取目录并生成建议";
  const fastStartLabel = "按默认配置开始整理";
  const displayPath = isFullCategorize ? effectiveOutputDir || firstSourcePath(sources) : firstSourcePath(sources);

  useEffect(() => {
    if (skipStrategyPrompt && step !== 1) {
      setStep(1);
    }
  }, [skipStrategyPrompt, step]);

  const getLaunchValidationMessage = useCallback((mode: "default" | "direct" = "default"): string | null => {
    if (sources.length === 0) {
      return "请先添加至少一个待整理来源。";
    }
    if (isAssignExisting && selectedTargetProfileId.trim() && targetProfilesLoading) {
      return "正在读取目录配置，请稍后再开始。";
    }
    if (isAssignExisting && selectedTargetProfileId.trim() && !selectedProfile) {
      return "当前选择的目录配置已不存在，请重新选择目录配置或手动添加目标目录。";
    }
    if (isAssignExisting && effectiveTargetDirectories.length === 0 && !selectedTargetProfileId.trim()) {
      return mode === "direct"
        ? "当前已开启“直接使用默认值启动”，但默认整理方式是“归入现有目录”，还没有可用的目标目录。请先关闭直启后进入完整流程补充目标目录，或到设置中改用“生成新的分类结构”。"
        : "归入现有目录时，至少需要选择一个目录配置或手动添加目标目录。";
    }
    if (isFullCategorize && !effectiveNewDirectoryRoot) {
      return mode === "direct"
        ? "当前默认配置没有可用的新目录生成位置。请先到设置补全默认放置规则，或关闭直启后手动调整。"
        : "生成新的分类结构前，必须先指定新目录生成位置。";
    }
    if (isAssignExisting && !effectiveNewDirectoryRoot) {
      return mode === "direct"
        ? "当前默认整理方式是“归入现有目录”，但缺少待确认区的默认推导根。请先到设置补全默认放置规则。"
        : "归入现有目录时，需要一个默认放置根来推导待确认区（不会自动归入目标目录），但不会用它自动创建未知目标目录。";
    }
    if (!effectiveReviewRoot) {
      return mode === "direct"
        ? "当前默认配置没有可用的待确认区位置。请先到设置补全默认放置规则。"
        : "当前任务没有可用的待确认区位置。";
    }
    return null;
  }, [
    effectiveNewDirectoryRoot,
    effectiveReviewRoot,
    effectiveTargetDirectories.length,
    isAssignExisting,
    isFullCategorize,
    selectedProfile,
    selectedTargetProfileId,
    sources.length,
    targetProfilesLoading,
  ]);

  const stepThreeValidationMessage = step === 3 ? getLaunchValidationMessage("default") : null;
  const fastStartValidationMessage = step === 1 && skipStrategyPrompt && sources.length > 0
    ? getLaunchValidationMessage("direct")
    : null;

  useEffect(() => {
    const restoredDraft = sanitizeLauncherDraft(readLauncherDraft());
    launcherDraftRef.current = restoredDraft;
    if (restoredDraft) {
      setStep(restoredDraft.step || 1);
      if (restoredDraft.strategy) {
        setStrategy(restoredDraft.strategy);
      }
      setSources(restoredDraft.sources || []);
      setSourceImportGroups(restoredDraft.sourceImportGroups || []);
      setSourceDraftType(restoredDraft.sourceDraftType || "directory");
      setSourceDraftPath(restoredDraft.sourceDraftPath || "");
      setNewDirectoryRoot(restoredDraft.newDirectoryRoot || "");
      setReviewRoot(restoredDraft.reviewRoot || "");
      setReviewFollowsNewRoot(restoredDraft.reviewFollowsNewRoot ?? true);
      setShowPlacementOverrides(Boolean(restoredDraft.showPlacementOverrides));
      setManualTargetDirectories(
        dedupeTargetDirectories(restoredDraft.manualTargetDirectories || []).map((item) => ({
          path: item.path,
          label: item.label || "",
          description: item.description || "",
        })),
      );
      setTargetDirectoryDraft(restoredDraft.targetDirectoryDraft || "");
      setSelectedTargetProfileId(restoredDraft.selectedTargetProfileId || "");
      setShowManualInput(Boolean(restoredDraft.showManualInput));
      setShowManualTargetInput(Boolean(restoredDraft.showManualTargetInput));
      setLaunchFlowOpen(Boolean(restoredDraft.sources?.length || restoredDraft.step && restoredDraft.step > 1));
    }
    setDraftHydrated(true);
  }, []);

  useEffect(() => {
    if (!draftHydrated || typeof window === "undefined") {
      return;
    }
    const draft: LauncherDraftState = {
      version: 1,
      step,
      strategy,
      sources,
      sourceImportGroups: pruneImportGroups(sourceImportGroups, sources),
      sourceDraftType,
      sourceDraftPath,
      newDirectoryRoot,
      reviewRoot,
      reviewFollowsNewRoot,
      showPlacementOverrides,
      manualTargetDirectories,
      targetDirectoryDraft,
      selectedTargetProfileId,
      showManualInput,
      showManualTargetInput,
    };
    window.localStorage.setItem(LAUNCHER_DRAFT_KEY, JSON.stringify(draft));
  }, [
    draftHydrated,
    manualTargetDirectories,
    newDirectoryRoot,
    pruneImportGroups,
    reviewFollowsNewRoot,
    reviewRoot,
    selectedTargetProfileId,
    showManualInput,
    showManualTargetInput,
    showPlacementOverrides,
    sourceDraftPath,
    sourceDraftType,
    sourceImportGroups,
    sources,
    step,
    strategy,
    targetDirectoryDraft,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function loadLaunchPreferences() {
      if (!draftHydrated) {
        return;
      }
      try {
        const api = createApiClient(apiBaseUrl, getApiToken());
        const data = await api.getSettings();
        if (cancelled) return;
        if (!launcherDraft?.strategy) {
          setStrategy(getLaunchStrategyFromConfig(data.global_config));
        }
        setLaunchConfig((data.global_config || {}) as LaunchStrategyConfig);
        if (launcherDraft?.reviewFollowsNewRoot === undefined) {
          setReviewFollowsNewRoot(data.global_config?.LAUNCH_REVIEW_FOLLOWS_NEW_ROOT !== false);
        }
        setTextModelConfigured(Boolean(data.status?.text_configured));
      } catch {
        if (!cancelled) {
          if (!launcherDraft?.strategy) {
            setStrategy(DEFAULT_STRATEGY_SELECTION);
          }
          setLaunchConfig(null);
          if (launcherDraft?.reviewFollowsNewRoot === undefined) {
            setReviewFollowsNewRoot(true);
          }
          setTextModelConfigured(true);
        }
      }
    }

    void loadLaunchPreferences();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, draftHydrated, launcherDraft?.reviewFollowsNewRoot, launcherDraft?.strategy]);

  useEffect(() => {
    setIsDesktopEnvironment(isTauriDesktop());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const syncActiveWorkspace = () => {
      setActiveWorkspaceTask(readActiveWorkspaceTask());
    };
    syncActiveWorkspace();
    window.addEventListener("storage", syncActiveWorkspace);
    window.addEventListener(APP_CONTEXT_EVENT, syncActiveWorkspace);
    return () => {
      window.removeEventListener("storage", syncActiveWorkspace);
      window.removeEventListener(APP_CONTEXT_EVENT, syncActiveWorkspace);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadCommonDirs() {
      try {
        const api = createApiClient(apiBaseUrl, getApiToken());
        const dirs = await api.getCommonDirs();
        if (!cancelled) setCommonDirs(dirs);
      } catch {
        if (!cancelled) setCommonDirs([]);
      }
    }
    void loadCommonDirs();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

  useEffect(() => {
    let cancelled = false;
    async function loadRecentHistory() {
      setHistoryLoading(true);
      try {
        const api = createApiClient(apiBaseUrl, getApiToken());
        const items = await api.getHistory();
        if (!cancelled) {
          setRecentHistory(items.slice(0, 5));
        }
      } catch {
        if (!cancelled) {
          setRecentHistory([]);
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    }
    void loadRecentHistory();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

  useEffect(() => {
    let cancelled = false;
    async function loadTargetProfiles() {
      setTargetProfilesLoading(true);
      try {
        const api = createApiClient(apiBaseUrl, getApiToken());
        const items = await api.getTargetProfiles();
        if (!cancelled) setTargetProfiles(items);
      } catch {
        if (!cancelled) setTargetProfiles([]);
      } finally {
        if (!cancelled) setTargetProfilesLoading(false);
      }
    }
    void loadTargetProfiles();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

  useEffect(() => {
    const defaultProfileId = String(launchConfig?.LAUNCH_DEFAULT_TARGET_PROFILE_ID || "").trim();
    if (!defaultProfileId || selectedTargetProfileId) {
      return;
    }
    if (targetProfiles.some((profile) => profile.profile_id === defaultProfileId)) {
      setSelectedTargetProfileId(defaultProfileId);
    }
  }, [launchConfig?.LAUNCH_DEFAULT_TARGET_PROFILE_ID, selectedTargetProfileId, targetProfiles]);

  function updateStrategy(updater: (previous: SessionStrategySelection) => SessionStrategySelection) {
    setStrategy((previous) => updater(previous));
  }

  const addSources = useCallback((nextItems: SessionSourceSelection[]) => {
    setLaunchFlowOpen(true);
    setSources((previous) => {
      const nextSources = dedupeSources([...previous, ...nextItems]);
      setSourceImportGroups((previousGroups) => pruneImportGroups(previousGroups, nextSources));
      return nextSources;
    });
    setSourceFeedback(null);
  }, [pruneImportGroups]);

  const resolveNativeDroppedSources = useCallback(async (paths: string[]) => {
    const normalizedPaths = paths.map((path) => path.trim()).filter(Boolean);
    if (!normalizedPaths.length) return [] as SessionSourceSelection[];
    if (!isTauriDesktop()) {
      return inferSourceSelectionsFromPaths(normalizedPaths);
    }

    const inspected = await inspectPathsWithTauri(normalizedPaths);
    const resolved = dedupeSources(
      inspected
        .filter((item) => item.is_dir || item.is_file)
        .map((item) => ({
          ...(item.is_dir
            ? createDirectorySource(item.path, "atomic")
            : ({ source_type: "file", path: item.path } as SessionSourceSelection)),
        })),
    );
    return resolved.length ? resolved : inferSourceSelectionsFromPaths(normalizedPaths);
  }, []);

  const resolveNativeDirectoryPaths = useCallback(async (paths: string[]) => {
    const normalizedPaths = paths.map((path) => path.trim()).filter(Boolean);
    if (!normalizedPaths.length) return [] as string[];
    if (!isTauriDesktop()) {
      return normalizedPaths.filter((path) => !/\.[^./\\]+$/.test(path));
    }

    const inspected = await inspectPathsWithTauri(normalizedPaths);
    const resolved = inspected
      .filter((item) => item.is_dir)
      .map((item) => item.path.trim())
      .filter(Boolean);
    const fallback = normalizedPaths.filter((path) => !/\.[^./\\]+$/.test(path));
    const unique = new Map<string, string>();
    for (const path of (resolved.length ? resolved : fallback)) {
      unique.set(path.toLowerCase(), path);
    }
    return Array.from(unique.values());
  }, []);

  const dragCallbacksRef = useRef({
    resolveNativeDroppedSources,
    addSources,
    resolveNativeDirectoryPaths,
  });
  useEffect(() => {
    dragCallbacksRef.current = {
      resolveNativeDroppedSources,
      addSources,
      resolveNativeDirectoryPaths,
    };
  }, [resolveNativeDroppedSources, addSources, resolveNativeDirectoryPaths]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void listenToTauriDragDrop((event) => {
      const payload = event.payload;
      if (isTauriDragLeavePayload(payload)) {
        setIsDropActive(false);
        setIsTargetDropActive(false);
        setIsDraggingGlobal(false);
        return;
      }

      const zone = findDropZoneForPosition(payload.position, [
        { key: "source", element: sourceDropZoneRef.current },
        { key: "target", element: targetDropZoneRef.current },
      ]);

      if (isTauriDragOverPayload(payload)) {
        setIsDraggingGlobal(true);
        setIsDropActive(zone === "source");
        setIsTargetDropActive(zone === "target");
        return;
      }

      if (!isTauriDragDropPayload(payload)) {
        return;
      }

      setIsDraggingGlobal(false);
      setIsDropActive(false);
      setIsTargetDropActive(false);

      if (zone === "source") {
        void dragCallbacksRef.current.resolveNativeDroppedSources(payload.paths).then((droppedSources) => {
          if (cancelled) return;
          if (!droppedSources.length) {
            setError("当前环境暂时无法从拖拽内容里读取本地绝对路径。你可以改用“移动整个文件夹”“添加单个文件”或手动输入路径。");
            return;
          }
          dragCallbacksRef.current.addSources(droppedSources);
          setError(null);
        });
        return;
      }

      if (zone === "target") {
        void dragCallbacksRef.current.resolveNativeDirectoryPaths(payload.paths).then((dirs) => {
          if (cancelled) return;
          if (!dirs.length) {
            setError("只能拖拽文件夹（目录）作为目标目录配置，已忽略文件。若路径识别失败请改用手动输入。");
            return;
          }
          setManualTargetDirectories((previous) => {
            const next = dedupeTargetDirectories([...previous, ...dirs.map((path) => ({ path, label: "", description: "" }))]);
            return next.map((item) => ({
              path: item.path,
              label: item.label || "",
              description: item.description || "",
            }));
          });
          setError(null);
        });
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
      setIsDropActive(false);
      setIsTargetDropActive(false);
      unlisten?.();
    };
  }, []);

  function removeSource(path: string, sourceType: SessionSourceSelection["source_type"]) {
    setSources((previous) => {
      const nextSources = previous.filter((item) => !(item.path === path && item.source_type === sourceType));
      setSourceImportGroups((previousGroups) => pruneImportGroups(previousGroups, nextSources));
      return nextSources;
    });
  }

  function updateDirectorySourceMode(path: string, directoryMode: DirectorySourceMode) {
    setSources((previous) =>
      dedupeSources(
        previous.map((item) =>
          item.source_type === "directory" && item.path === path
            ? createDirectorySource(item.path, directoryMode)
            : item,
        ),
      ),
    );
  }

  function toggleImportGroupExpanded(groupId: string) {
    setSourceImportGroups((previous) =>
      previous.map((group) =>
        group.group_id === groupId ? { ...group, expanded: !group.expanded } : group,
      ),
    );
  }

  function removeImportGroup(groupId: string) {
    const group = sourceImportGroupViews.find((item) => item.group_id === groupId);
    if (!group) return;
    const keysToRemove = new Set(group.item_keys);
    setSources((previous) => previous.filter((item) => !keysToRemove.has(sourceSelectionKey(item))));
    setSourceImportGroups((previous) => previous.filter((item) => item.group_id !== groupId));
  }

  function clearAllSources() {
    setSources([]);
    setSourceImportGroups([]);
    setSourceFeedback(null);
    setShowManualInput(false);
    setSourceDraftPath("");
    setError(null);
  }

  function addManualSource() {
    const path = sourceDraftPath.trim();
    if (!path) {
      setError("请先输入文件或文件夹路径。");
      return;
    }
    addSources([sourceSelectionFromDraft(path, sourceDraftType)]);
    setSourceDraftPath("");
    setError(null);
  }

  async function importDirectoryEntries(path: string, options?: { replaceSourcePath?: string }) {
    setError(null);
    setSourceFeedback(null);

    if (!isTauriDesktop()) {
      setError("当前环境还不能直接读取文件夹内容。请在桌面端使用“整理文件夹内容”。");
      return;
    }

    try {
      const directoryResult = await listDirectoryEntriesResultWithTauri(path);
      if (!directoryResult.ok) {
        setError(directoryResult.message || "现在还不能读取这个文件夹的内容，请检查权限或路径是否存在。");
        return;
      }
      const entries = directoryResult.items;
      const nextItems = dedupeSources(entries.map(mapDirectoryEntryToSource).filter((item): item is SessionSourceSelection => Boolean(item)));
      if (!nextItems.length) {
        setSourceFeedback({
          tone: "info",
          message: "这个文件夹下没有可导入的顶层项目。",
        });
        return;
      }

      const replaceSourcePath = options?.replaceSourcePath?.trim();
      const replaceSourceKey = replaceSourcePath ? pathKey(replaceSourcePath) : "";
      const baseSources = replaceSourcePath
        ? sources.filter((item) => !(item.source_type === "directory" && pathKey(item.path) === replaceSourceKey))
        : sources;
      const existingKeys = new Set(baseSources.map((item) => sourceSelectionKey(item)));
      const importedItems = nextItems.filter((item) => !existingKeys.has(sourceSelectionKey(item)));
      const skippedCount = nextItems.length - importedItems.length;

      if (!importedItems.length) {
        setSourceFeedback({
          tone: "info",
          message: skippedCount > 0 ? `已跳过 ${skippedCount} 个已在列表中的项目。` : "这个文件夹下没有可导入的顶层项目。",
        });
        return;
      }

      const insertionIndex = replaceSourcePath
        ? sources.findIndex((item) => item.source_type === "directory" && pathKey(item.path) === replaceSourceKey)
        : -1;
      const nextSources = replaceSourcePath && insertionIndex >= 0
        ? [
          ...baseSources.slice(0, insertionIndex),
          ...importedItems,
          ...baseSources.slice(insertionIndex),
        ]
        : [...baseSources, ...importedItems];
      const importedKeys = importedItems.map((item) => sourceSelectionKey(item));

      setSources(nextSources);
      setSourceImportGroups((previous) =>
        pruneImportGroups(
          [
            ...previous,
            {
              group_id: createImportGroupId(),
              source_path: path,
              item_keys: importedKeys,
              expanded: false,
            },
          ],
          nextSources,
        ),
      );

      setSourceFeedback({
        tone: "success",
        message: skippedCount > 0 || directoryResult.ignored_count > 0
          ? `已导入“${path}”下的 ${importedItems.length} 个顶层项目，已跳过 ${skippedCount} 个重复项，另有 ${directoryResult.ignored_count} 个条目因权限或读取失败被忽略。`
          : `已导入“${path}”下的 ${importedItems.length} 个顶层项目。`,
      });
    } catch {
      setError("现在还不能读取这个文件夹的内容，请检查桌面端是否正常运行。");
    }
  }

  async function handleChooseDirectories() {
    setError(null);
    if (isTauriDesktop()) {
      const directories = await pickDirectoriesWithTauri();
      if (directories?.length) {
        addSources(directories.map((path) => createDirectorySource(path, "atomic")));
      }
      return;
    }

    try {
      const api = createApiClient(apiBaseUrl, getApiToken());
      const response = await api.selectDir();
      if (response.path) {
        addSources([createDirectorySource(response.path, "atomic")]);
      }
    } catch {
      setError("现在还不能打开文件夹选择器，请检查本地服务是否正常运行。");
    }
  }

  async function handleImportDirectoryEntries() {
    setError(null);
    setSourceFeedback(null);
    if (!isTauriDesktop()) {
      setError("当前环境还不能直接读取文件夹内容。请在桌面端使用这个入口。");
      return;
    }
    try {
      const path = await pickDirectoryWithTauri();
      if (!path) return;
      await importDirectoryEntries(path);
    } catch {
      setError("现在还不能打开文件夹选择器，请检查桌面端是否正常运行。");
    }
  }

  async function handleImportFromSource(item: SessionSourceSelection) {
    if (item.source_type !== "directory") return;
    await importDirectoryEntries(item.path, { replaceSourcePath: item.path });
  }

  async function handleChooseFiles() {
    setError(null);
    if (!isTauriDesktop()) {
      setError("当前仅桌面环境支持文件批量选择。你仍然可以手动输入文件路径或直接拖拽文件进来。");
      return;
    }

    try {
      const files = await pickFilesWithTauri();
      if (files?.length) {
        addSources(files.map((path) => ({ source_type: "file" as const, path })));
      }
    } catch {
      setError("现在还不能打开文件选择器，请检查本地服务是否正常运行。");
    }
  }

  function renderSourceRow(item: SessionSourceSelection, options?: { nested?: boolean }) {
    const nested = options?.nested === true;
    const isDirectory = item.source_type === "directory";
    const isAtomic = normalizeDirectoryMode(item) === "atomic";

    return (
      <div
        key={sourceSelectionKey(item)}
        className={cn(
          "group flex items-center justify-between gap-3 rounded-lg border border-on-surface/8 bg-surface-container-lowest px-3 py-2 transition-all hover:border-on-surface/20 active:scale-[0.99]",
          nested
            ? "border-on-surface/8 bg-surface px-2.5 py-2"
            : "border-on-surface/10 bg-surface-container-lowest",
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          <div className={cn(
            "flex shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary",
            nested ? "h-9 w-9" : "h-10 w-10",
          )}>
            {isDirectory ? <FolderOpen className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
          </div>
          <div className="min-w-0">
            <div className={cn("truncate font-black tracking-tight text-on-surface", nested ? "text-[13px]" : "text-[14px]")}>
              {item.path.split(/[\\/]/).pop() || item.path}
            </div>
            <div className="truncate font-mono text-[10.5px] font-medium text-ui-muted opacity-40 uppercase tracking-tighter" title={item.path}>{item.path}</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="rounded bg-on-surface/5 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest text-ui-muted">
                {getSourceBehaviorLabel(item)}
              </span>
              <span className="text-[10px] font-bold text-ui-muted opacity-40">{getSourceBehaviorHint(item)}</span>
              {isDirectory ? (
                isAtomic ? (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void handleImportFromSource(item)}
                    className="rounded-[6px] px-2 py-1 text-[10.5px] font-bold text-primary transition-colors hover:bg-primary/8"
                  >
                    改为导入里面的项
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => updateDirectorySourceMode(item.path, "atomic")}
                    className="rounded-[6px] px-2 py-1 text-[10.5px] font-bold text-primary transition-colors hover:bg-primary/8"
                  >
                    改为整体移动
                  </button>
                )
              ) : null}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => removeSource(item.path, item.source_type)}
          disabled={loading}
          className="shrink-0 rounded-[6px] p-2 text-on-surface-variant/50 transition-colors hover:bg-error/10 hover:text-error opacity-0 group-hover:opacity-100 focus:opacity-100"
          title="移除"
        >
          <Trash2 className="h-4.5 w-4.5" />
        </button>
      </div>
    );
  }

  function removeManualTargetDirectory(path: string) {
    setManualTargetDirectories((previous) => previous.filter((item) => pathKey(item.path) !== pathKey(path)));
  }

  function updateTargetDirectoryDraft(path: string, patch: Partial<TargetDirectoryDraft>) {
    setManualTargetDirectories((previous) => {
      const existing =
        previous.find((item) => pathKey(item.path) === pathKey(path))
        || effectiveTargetDirectories.find((item) => pathKey(item.path) === pathKey(path))
        || { path, label: "", description: "" };
      const next = dedupeTargetDirectories([
        ...previous.filter((item) => pathKey(item.path) !== pathKey(path)),
        {
          path: existing.path,
          label: patch.label ?? existing.label ?? "",
          description: patch.description ?? existing.description ?? "",
        },
      ]);
      return next.map((item) => ({
        path: item.path,
        label: item.label || "",
        description: item.description || "",
      }));
    });
  }

  function addManualTargetDirectory() {
    const path = targetDirectoryDraft.trim();
    if (!path) {
      setError("请先输入目标目录路径。");
      return;
    }
    setManualTargetDirectories((previous) => {
      const next = dedupeTargetDirectories([...previous, { path, label: "", description: "" }]);
      return next.map((item) => ({
        path: item.path,
        label: item.label || "",
        description: item.description || "",
      }));
    });
    setTargetDirectoryDraft("");
    setError(null);
  }

  async function handleAddTargetDirectories() {
    setError(null);
    if (isTauriDesktop()) {
      const paths = await pickDirectoriesWithTauri();
      if (paths?.length) {
        setManualTargetDirectories((previous) => {
          const next = dedupeTargetDirectories([...previous, ...paths.map((path) => ({ path, label: "", description: "" }))]);
          return next.map((item) => ({
            path: item.path,
            label: item.label || "",
            description: item.description || "",
          }));
        });
      }
      return;
    }
    try {
      const api = createApiClient(apiBaseUrl, getApiToken());
      const response = await api.selectDir();
      if (response.path) {
        setManualTargetDirectories((previous) => {
          const next = dedupeTargetDirectories([...previous, { path: response.path!, label: "", description: "" }]);
          return next.map((item) => ({
            path: item.path,
            label: item.label || "",
            description: item.description || "",
          }));
        });
      }
    } catch {
      setError("现在还不能打开目录选择器，请检查本地服务是否正常运行。");
    }
  }

  async function handleSelectPlacementRoot(kind: "new" | "review") {
    setError(null);
    try {
      let selectedPath: string | null = null;
      if (isTauriDesktop()) {
        selectedPath = await pickDirectoryWithTauri();
      } else {
        const api = createApiClient(apiBaseUrl, getApiToken());
        const response = await api.selectDir();
        selectedPath = response.path;
      }
      if (!selectedPath) return;
      if (kind === "new") {
        setNewDirectoryRoot(selectedPath);
        if (reviewFollowsNewRoot) setReviewRoot("");
      } else {
        setReviewRoot(selectedPath);
        setReviewFollowsNewRoot(false);
      }
    } catch {
      setError(isTauriDesktop() ? "没有打开目录选择窗口，请再试一次。" : "现在还不能打开目录选择器，请检查本地服务是否正常运行。");
    }
  }

  async function handleSaveCurrentDirectoriesAsProfile() {
    const name = profileNameDraft.trim();
    if (!name) {
      setError("请先输入分类目录配置名称。");
      return;
    }
    if (effectiveTargetDirectories.length === 0) {
      setError("当前没有可保存的目标目录。");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const api = createApiClient(apiBaseUrl, getApiToken());
      const profile = await api.createTargetProfile({
        name,
        directories: effectiveTargetDirectories.map((item) => ({
          path: item.path,
          label: item.label || undefined,
          description: item.description || undefined,
        })),
      });
      setTargetProfiles((previous) => [profile, ...previous.filter((item) => item.profile_id !== profile.profile_id)]);
      setSelectedTargetProfileId(profile.profile_id);
      setProfileNameDraft("");
    } catch (err: any) {
      setError(err instanceof Error ? err.message : "保存目录配置失败，请再试一次。");
    } finally {
      setLoading(false);
    }
  }

  function validateBeforeLaunch(mode: "default" | "direct" = "default"): boolean {
    const message = getLaunchValidationMessage(mode);
    if (message) {
      setError(message);
      return false;
    }
    return true;
  }

  function validateStepOne(): boolean {
    if (sources.length === 0) {
      setError("请先添加至少一个待整理来源。");
      return false;
    }
    return true;
  }

  function buildLaunchRequest(resumeIfExists: boolean): LaunchRequestState {
    const normalizedStrategy: SessionStrategySelection = {
      ...strategy,
      organize_method: organizeMethod,
      output_dir: effectiveOutputDir || undefined,
      target_profile_id: selectedTargetProfileId.trim() || undefined,
      target_directory_details: isAssignExisting ? effectiveTargetDirectories : undefined,
      new_directory_root: effectiveNewDirectoryRoot || undefined,
      review_root: effectiveReviewRoot || undefined,
    };

    return {
      sources,
      resume_if_exists: resumeIfExists,
      organize_method: organizeMethod,
      strategy: normalizedStrategy,
      output_dir: isFullCategorize ? effectiveOutputDir || undefined : undefined,
      target_profile_id: isAssignExisting ? selectedTargetProfileId.trim() || undefined : undefined,
      target_directories: isAssignExisting ? effectiveTargetDirectories.map((item) => item.path) : undefined,
      target_directory_details: isAssignExisting ? effectiveTargetDirectories : undefined,
      new_directory_root: effectiveNewDirectoryRoot || undefined,
      review_root: effectiveReviewRoot || undefined,
      display_path: displayPath,
    };
  }

  async function launchCurrentRequest(resumeIfExists: boolean, options?: { directStart?: boolean }) {
    if (!textModelConfigured) {
      setError("请先在设置中配置文本模型，然后再开始整理分析。");
      return;
    }
    if (!validateBeforeLaunch(options?.directStart ? "direct" : "default")) return;

    const launchRequest = buildLaunchRequest(resumeIfExists);
    setLoading(true);
    setLaunchTransitionOpen(true);
    setError(null);

    try {
      const api = createApiClient(apiBaseUrl, getApiToken());
      const response = await createLaunchSession(api, launchRequest);
      if (response.mode === "resume_available" && response.restorable_session?.session_id) {
        setLaunchTransitionOpen(false);
        setLoading(false);
        setResumePrompt({
          sessionId: response.restorable_session.session_id,
          snapshot: response.restorable_session,
          launch: launchRequest,
        });
        return;
      }
      if (!response.session_id) throw new Error("没有成功创建整理会话，请再试一次。");
      clearLauncherDraft();
      const workspaceRoute = buildWorkspaceRoute("progress", {
        sessionId: response.session_id,
        dir: launchRequest.display_path || firstSourcePath(launchRequest.sources),
        autoScan: true,
      });
      rememberWorkspaceRoute(workspaceRoute);
      router.push(workspaceRoute);
    } catch (err: any) {
      setLaunchTransitionOpen(false);
      if (err.message && err.message.toLowerCase().includes("failed to fetch")) {
        setError(`现在连不上本地服务，请确认它是否已经启动（${apiBaseUrl}）。`);
      } else {
        setError(err instanceof Error ? err.message : "创建会话或启动扫描失败，请再试一次。");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleStartFresh() {
    if (!resumePrompt) return;
    setLoading(true);
    setLaunchTransitionOpen(true);
    setError(null);

    try {
      const api = createApiClient(apiBaseUrl, getApiToken());
      const response = await startFreshSession(api, resumePrompt.sessionId, resumePrompt.snapshot.stage, resumePrompt.launch);
      setResumePrompt(null);
      if (!response.session_id) throw new Error("没有成功重新开始，请再试一次。");
      clearLauncherDraft();
      const workspaceRoute = buildWorkspaceRoute("progress", {
        sessionId: response.session_id,
        dir: resumePrompt.launch.display_path || firstSourcePath(resumePrompt.launch.sources),
        autoScan: true,
      });
      rememberWorkspaceRoute(workspaceRoute);
      router.push(workspaceRoute);
    } catch (err: any) {
      setLaunchTransitionOpen(false);
      if (err.message && err.message.toLowerCase().includes("failed to fetch")) {
        setError(`现在连不上本地服务，请确认它是否已经启动（${apiBaseUrl}）。`);
      } else {
        setError(err instanceof Error ? err.message : "重新开始并启动扫描失败，请再试一次。");
      }
    } finally {
      setLoading(false);
    }
  }

  function handleConfirmResume() {
    if (!resumePrompt) return;
    if (isCompletedResume) {
      handleReadOnlyView();
      return;
    }
    const dir = resumePrompt.launch.display_path || firstSourcePath(resumePrompt.launch.sources);
    const shouldAutoScan = Boolean(resumeStageView?.isDraftLike);
    setResumePrompt(null);
    setLaunchTransitionOpen(false);
    setLoading(false);
    const workspaceRoute = resumePrompt.snapshot
      ? getWorkspaceRouteForSnapshot(resumePrompt.snapshot, { dir, autoScan: shouldAutoScan })
      : buildWorkspaceRoute(shouldAutoScan ? "progress" : "plan", {
        sessionId: resumePrompt.sessionId,
        dir,
        autoScan: shouldAutoScan,
      });
    rememberWorkspaceRoute(workspaceRoute);
    router.push(workspaceRoute);
  }

  function handleReadOnlyView() {
    if (!resumePrompt) return;
    const dir = resumePrompt.launch.display_path || firstSourcePath(resumePrompt.launch.sources);
    setResumePrompt(null);
    setLaunchTransitionOpen(false);
    setLoading(false);
    const route = resumePrompt.snapshot
      ? getWorkspaceRouteForSnapshot(resumePrompt.snapshot, { dir, readonly: true })
      : buildWorkspaceRoute("plan", { sessionId: resumePrompt.sessionId, dir, readonly: true });
    router.push(route);
  }

  function handleCancelResume() {
    setResumePrompt(null);
    setLaunchTransitionOpen(false);
    setLoading(false);
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDropActive(false);
    const droppedSources = extractDroppedSources(event.dataTransfer);
    if (!droppedSources.length) {
      setError("当前环境暂时无法从拖拽内容里读取本地绝对路径。你可以改用“移动整个文件夹”“添加单个文件”或手动输入路径。");
      return;
    }
    addSources(droppedSources);
    setError(null);
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDropActive(true);
  }

  function handleDragLeave(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDropActive(false);
  }

  function handleTargetDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsTargetDropActive(false);
    const droppedSources = extractDroppedSources(event.dataTransfer);
    const dirs = droppedSources.filter(s => s.source_type === "directory").map(s => s.path);
    if (!dirs.length) {
      setError("只能拖拽文件夹（目录）作为目标目录配置，已忽略文件。若路径识别失败请改用手动输入。");
      return;
    }
    setManualTargetDirectories((previous) => {
      const next = dedupeTargetDirectories([...previous, ...dirs.map((path) => ({ path, label: "", description: "" }))]);
      return next.map((item) => ({
        path: item.path,
        label: item.label || "",
        description: item.description || "",
      }));
    });
    setError(null);
  }

  function handleTargetDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsTargetDropActive(true);
  }

  function handleTargetDragLeave(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsTargetDropActive(false);
  }

  function goToStepTwo() {
    if (!validateStepOne()) return;
    setError(null);
    setStep(2);
  }

  function goToStepThree() {
    if (!validateStepOne()) return;
    setError(null);
    setStep(3);
  }

  const renderLaunchWorkbench = () => (
    <section className="rounded-lg border border-on-surface/8 bg-surface-container-lowest px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-on-surface/6 pb-3">
        <div className="min-w-0">
          <span className="text-[9px] font-black uppercase tracking-[0.2em] text-ui-muted opacity-40">主控制台</span>
          <h2 className="mt-0.5 text-[16px] font-black tracking-tight text-on-surface">
            继续手头任务，或开始一次新的整理
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[6px] border px-2.5 py-1 text-[11px] font-black uppercase tracking-wider",
              textModelConfigured
                ? "border-success/16 bg-success/[0.05] text-success-dim"
                : "border-warning/18 bg-warning/8 text-warning",
            )}
          >
            {textModelConfigured ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
            {textModelConfigured ? "文本模型可用" : "文本模型待配置"}
          </span>
          <Button
            variant="secondary"
            onClick={() => router.push("/settings?tab=text")}
            className="h-8 rounded-[7px] px-3 text-[11px] font-black uppercase tracking-wider"
          >
            模型设置
          </Button>
        </div>
      </div>

      <div className="grid gap-4 pt-4">
        <div className="space-y-3">
          {activeWorkspaceTask ? (
            <button
              type="button"
              onClick={() => router.push(activeWorkspaceTask.route)}
              className="group grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5 rounded-lg border border-primary/20 bg-primary/[0.03] px-4 py-3 text-left transition-all hover:bg-primary/[0.06] hover:shadow-[0_4px_12px_rgba(var(--primary-rgb),0.03)]"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-white shadow-sm transition-transform group-hover:scale-105">
                <Activity className="h-4.5 w-4.5 animate-pulse" />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-black text-on-surface">返回挂起中的任务</p>
                <p className="mt-0.5 block max-w-full truncate font-mono text-[11.5px] font-medium text-ui-muted/60">
                  {activeWorkspaceTask.route}
                </p>
              </div>
              <span className="shrink-0 flex items-center justify-center h-7 rounded-md bg-primary px-3 text-[11px] font-black text-white uppercase tracking-wider transition-transform group-hover:translate-x-0.5">
                继续执行
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-3.5 rounded-lg border border-on-surface/6 bg-on-surface/[0.012] px-4 py-3 relative overflow-hidden select-none">
              <div className="absolute inset-0 bg-[radial-gradient(#00000003_1px,transparent_1px)] [background-size:12px_12px] opacity-40 pointer-events-none" />
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-on-surface/5 text-on-surface/30">
                <Activity className="h-4.5 w-4.5 opacity-60" />
              </span>
              <div>
                <p className="text-[13px] font-black text-on-surface/80">当前没有挂起的会话</p>
                <p className="mt-0.5 text-[11.5px] font-medium text-ui-muted/50">主工作台处于闲置状态，添加整理来源即可唤起新任务。</p>
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => {
                setStep(1);
                setShowManualInput(false);
                setLaunchFlowOpen(true);
              }}
              className="group relative flex flex-col items-start rounded-lg border border-on-surface/8 bg-surface p-4 text-left transition-all hover:border-primary/20 hover:bg-on-surface/[0.01] hover:shadow-[0_4px_16px_rgba(0,0,0,0.02)] active:scale-[0.98]"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/8 text-primary transition-all group-hover:scale-110 group-hover:bg-primary/12">
                <Plus className="h-4.5 w-4.5" />
              </div>
              <p className="mt-3 text-[13px] font-black text-on-surface tracking-tight">新建整理</p>
              <p className="mt-1 text-[11.5px] font-medium leading-relaxed text-ui-muted/60">拖入或混选本地文件与文件夹，由 AI 自动推导分类目录结构。</p>
            </button>
            <button
              type="button"
              onClick={() => router.push("/history")}
              className="group relative flex flex-col items-start rounded-lg border border-on-surface/8 bg-surface p-4 text-left transition-all hover:border-primary/20 hover:bg-on-surface/[0.01] hover:shadow-[0_4px_16px_rgba(0,0,0,0.02)] active:scale-[0.98]"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-sky-500/8 text-sky-600 transition-all group-hover:scale-110 group-hover:bg-sky-500/12 dark:text-sky-400">
                <History className="h-4.5 w-4.5" />
              </div>
              <p className="mt-3 text-[13px] font-black text-on-surface tracking-tight">整理历史</p>
              <p className="mt-1 text-[11.5px] font-medium leading-relaxed text-ui-muted/60">检索以往的历史整理方案与操作归档，并可在此一键安全回退。</p>
            </button>
            <button
              type="button"
              onClick={() => router.push("/icons")}
              className="group relative flex flex-col items-start rounded-lg border border-on-surface/8 bg-surface p-4 text-left transition-all hover:border-primary/20 hover:bg-on-surface/[0.01] hover:shadow-[0_4px_16px_rgba(0,0,0,0.02)] active:scale-[0.98]"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-amber-500/8 text-amber-600 transition-all group-hover:scale-110 group-hover:bg-amber-500/12 dark:text-amber-400">
                <Sparkles className="h-4.5 w-4.5" />
              </div>
              <p className="mt-3 text-[13px] font-black text-on-surface tracking-tight">图标工坊</p>
              <p className="mt-1 text-[11.5px] font-medium leading-relaxed text-ui-muted/60">为新建出来的文件夹智能应用各种精美图标，提升文件视觉辨识度。</p>
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-on-surface/8 bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-ui-muted opacity-40">历史轨迹</span>
              <span className="h-0.5 w-0.5 rounded-full bg-on-surface/10" />
              <h3 className="text-[12px] font-black text-on-surface uppercase tracking-tight">最近记录</h3>
            </div>
            <button
              type="button"
              onClick={() => router.push("/history")}
              className="rounded-md px-2.5 py-1 text-[11px] font-black text-primary hover:bg-primary/8 uppercase tracking-wider transition-colors"
            >
              全部记录
            </button>
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            {historyLoading ? (
              <div className="col-span-full flex items-center gap-2 py-5 text-[11.5px] font-black text-ui-muted/60">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                正在读取最近记录
              </div>
            ) : recentHistory.length ? (
              recentHistory.map((entry) => (
                <button
                  key={entry.execution_id}
                  type="button"
                  onClick={() => router.push(isHistorySessionLike(entry) ? getHistoryRoute(entry) : `/history?entry_id=${entry.execution_id}`)}
                  className="group flex w-full items-center justify-between gap-3 rounded-lg border border-on-surface/[0.04] bg-on-surface/[0.005] px-3 py-2.5 text-left transition-all hover:border-primary/10 hover:bg-on-surface/[0.02]"
                >
                  <div className="min-w-0 flex-1 flex items-start gap-2.5">
                    <span className={cn(
                      "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                      isHistorySessionLike(entry) ? "bg-primary animate-pulse" : entry.status === "partial_failure" ? "bg-warning" : "bg-success-dim",
                    )} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-black text-on-surface/85 group-hover:text-on-surface transition-colors">{getHistoryDisplayName(entry)}</p>
                      <p className="mt-0.5 truncate text-[11px] font-medium text-ui-muted/50">
                        {getHistoryStatusLabel(entry)} · {formatDisplayDate(entry.created_at)}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 flex items-center justify-center rounded px-2 py-1 text-[10px] font-black text-primary bg-primary/5 opacity-0 translate-x-2 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0 uppercase tracking-widest">
                    {getHistoryActionLabel(entry)}
                  </span>
                </button>
              ))
            ) : (
              <div className="col-span-full py-5 text-[12px] font-medium text-ui-muted/60">还没有整理记录。</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );

  return (
    <>
      <LaunchTransitionOverlay open={launchTransitionOpen} targetDir={displayPath} />
      <div className={cn(
        "relative flex h-full w-full bg-surface antialiased transition-all duration-500",
        isDraggingGlobal ? "after:absolute after:inset-0 after:z-50 after:pointer-events-none after:ring-[4px] after:ring-inset after:ring-primary/40 after:bg-primary/[0.02] after:transition-all after:duration-300" : ""
      )}>
        <div className="flex w-full flex-1 overflow-hidden">
          {/* Main workspace section */}
          <div className="flex flex-1 flex-col overflow-y-auto px-6 xl:px-10 scrollbar-thin relative bg-surface">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="mx-auto flex w-full max-w-[860px] flex-col gap-3 py-6"
            >


              {!textModelConfigured ? <ModelConfigBanner /> : null}

              <AnimatePresence>
                {error ? (
                  <div className="mb-6">
                    <ErrorAlert
                      title="操作未完成"
                      message={error}
                      onClose={() => setError(null)}
                    />
                  </div>
                ) : null}
              </AnimatePresence>

              {!error && sourceFeedback ? (
                <div
                  className={cn(
                    "mb-6 flex items-start gap-3 rounded-[8px] border px-4 py-3",
                    sourceFeedback.tone === "success"
                      ? "border-success/18 bg-success/10 text-success-dim"
                      : "border-primary/18 bg-primary/8 text-primary",
                  )}
                >
                  <div className={cn(
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                    sourceFeedback.tone === "success" ? "bg-success/12" : "bg-primary/10",
                  )}>
                    {sourceFeedback.tone === "success" ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <Layers3 className="h-4 w-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-bold">
                      {sourceFeedback.tone === "success" ? "来源已更新" : "来源提示"}
                    </p>
                    <p className="mt-1 text-[12px] font-medium leading-6">{sourceFeedback.message}</p>
                  </div>
                </div>
              ) : null}

              {!error && fastStartValidationMessage ? (
                <div className="mb-4">
                  <ErrorAlert
                    title="默认配置还不完整"
                    message={fastStartValidationMessage}
                  />
                </div>
              ) : null}

              {!error && !fastStartValidationMessage && stepThreeValidationMessage ? (
                <div className="mb-4">
                  <ErrorAlert
                    title="继续前请先补全当前信息"
                    message={stepThreeValidationMessage}
                  />
                </div>
              ) : null}

              {!launchFlowOpen ? renderLaunchWorkbench() : null}

              <div hidden={!launchFlowOpen} className={cn("flex flex-col gap-3", !launchFlowOpen && "hidden")}>
                <div className="flex items-center justify-between rounded-[9px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3">
                  <div>
                    <div className="text-[12px] font-bold text-ui-muted/70">新建整理</div>
                    <h2 className="mt-0.5 text-[17px] font-black tracking-tight text-on-surface">选择来源并开始新的整理任务</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLaunchFlowOpen(false)}
                    className="rounded-[7px] border border-on-surface/10 bg-surface px-3 py-1.5 text-[12px] font-bold text-on-surface/70 transition-colors hover:border-primary/20 hover:text-primary"
                  >
                    返回启动工作台
                  </button>
                </div>

                {/* Desktop Native Header & Stepper */}
                <div className="mb-3 flex flex-col items-center border-b border-on-surface/5 pb-4 pt-1">
                  <div className="flex items-center justify-center gap-2">
                    {stepItems.map((item, index) => {
                      const active = step === item.id;
                      const completed = step > item.id;
                      return (
                        <div key={item.id} className="flex items-center">
                          <div className={cn(
                            "flex items-center gap-2.5 rounded-full px-3 py-1.5 transition-all duration-300",
                            active ? "bg-primary/10 ring-1 ring-primary/20" : "bg-transparent"
                          )}>
                            <div className={cn(
                              "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black transition-all",
                              active
                                ? "bg-primary text-white"
                                : completed
                                  ? "bg-success text-white"
                                  : "bg-on-surface/10 text-on-surface/40"
                            )}>
                              {completed ? <Check className="h-3 w-3 stroke-[3]" /> : item.id}
                            </div>
                            <span className={cn(
                              "text-[13px] font-black tracking-tight",
                              active ? "text-primary" : completed ? "text-on-surface/80" : "text-on-surface/20"
                            )}>
                              {item.title}
                            </span>
                          </div>
                          {index < stepItems.length - 1 && (
                            <div className="mx-4 flex items-center gap-1 opacity-20">
                              {[1, 2, 3].map(i => <div key={i} className="h-1 w-1 rounded-full bg-on-surface/30" />)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Main Content Pane */}
                <div className="flex-1 space-y-4">
                  <div className="space-y-4">
                    {step === 1 ? (
                      <div className="space-y-4">
                        <div className="mb-1 flex items-center gap-2">
                          <div className="flex h-6 w-6 items-center justify-center rounded-[4px] bg-primary/10 text-primary">
                            <Upload className="h-3.5 w-3.5" />
                          </div>
                          <h2 className="text-[14px] font-bold text-on-surface">本次整理对象</h2>
                        </div>
                        <div className="rounded-[8px] border border-warning/15 bg-warning/[0.035] px-4 py-3 text-warning">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-warning/10">
                              <ShieldAlert className="h-4 w-4" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-[12px] font-black tracking-tight text-on-surface">整理前安全建议</div>
                              <p className="mt-1 text-[11.5px] font-medium leading-5 text-ui-muted">
                                推荐从下载、桌面、照片、个人文档等明确资料夹开始。避免直接选择磁盘根目录、系统目录、软件安装目录或正在开发的代码工程。
                              </p>
                            </div>
                          </div>
                        </div>
                        {sources.length === 0 ? (
                          <motion.div
                            ref={sourceDropZoneRef}
                            animate={{
                              scale: isDropActive ? 1.01 : 1,
                            }}
                            className={cn(
                              getDropZoneSurfaceClassName({
                                isActive: isDropActive,
                                isDraggingGlobal,
                                idleClassName: "border-on-surface/10 bg-on-surface/[0.015] hover:bg-on-surface/[0.03]",
                                className: "group mt-1 flex flex-col items-center justify-center rounded-[8px] px-6 py-8 text-center",
                              }),
                            )}
                          >
                            <motion.div
                              animate={{
                                y: isDropActive ? [-2, 0, -2] : 0,
                              }}
                              transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                              className={cn(
                                "mb-3 flex h-12 w-12 items-center justify-center rounded-[10px] transition-all duration-300",
                                isDropActive ? "bg-primary text-white" : "bg-on-surface/5 text-on-surface/40"
                              )}
                            >
                              <Upload className="h-5 w-5" />
                            </motion.div>
                            <h3 className={cn(
                              "text-[16px] font-black tracking-tight transition-colors duration-300",
                              isDropActive ? "text-primary" : "text-on-surface"
                            )}>
                              {isDropActive ? "松手即可加入这次整理" : "请将想要整理的文件或文件夹拖放到此"}
                            </h3>
                            <div className={cn("mt-6 flex flex-col items-center gap-3 transition-opacity", isDropActive ? "opacity-20 pointer-events-none" : "opacity-100")}>
                              {isDesktopEnvironment ? (
                                <div className="relative flex flex-col items-center">
                                  <div className="flex items-stretch rounded-[8px] overflow-hidden bg-primary border border-primary/20 shadow-sm transition-all hover:shadow active:scale-[0.99]">
                                    <button
                                      type="button"
                                      disabled={loading}
                                      onClick={() => void handleImportDirectoryEntries()}
                                      className="h-11 px-6 text-[14.5px] font-black text-white hover:bg-white/10 active:bg-white/15 transition-colors flex items-center gap-2"
                                    >
                                      <span>整理文件夹内容</span>
                                      <Layers3 className="h-4 w-4 opacity-80" />
                                    </button>
                                    <div className="w-[1px] bg-white/20 my-2" />
                                    <button
                                      type="button"
                                      disabled={loading}
                                      onClick={() => setIsSourceDropdownOpen(!isSourceDropdownOpen)}
                                      className="px-3 hover:bg-white/10 active:bg-white/15 transition-colors flex items-center justify-center text-white"
                                    >
                                      <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", isSourceDropdownOpen && "rotate-180")} />
                                    </button>
                                  </div>

                                  {isSourceDropdownOpen && (
                                    <>
                                      <div className="fixed inset-0 z-40" onClick={() => setIsSourceDropdownOpen(false)} />
                                      <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 min-w-[200px] rounded-[10px] border border-on-surface/8 bg-surface p-1 shadow-lg animate-in fade-in slide-in-from-top-2 duration-200">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setIsSourceDropdownOpen(false);
                                            void handleChooseDirectories();
                                          }}
                                          className="w-full text-left px-4 py-2.5 rounded-[6px] text-[12px] font-bold text-on-surface hover:bg-on-surface/[0.04] transition-colors flex items-center justify-between"
                                        >
                                          <span>移动整个文件夹</span>
                                          <span className="text-[10px] text-ui-muted opacity-50 font-normal">保留外壳</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setIsSourceDropdownOpen(false);
                                            void handleChooseFiles();
                                          }}
                                          className="w-full text-left px-4 py-2.5 rounded-[6px] text-[12px] font-bold text-on-surface hover:bg-on-surface/[0.04] transition-colors flex items-center justify-between"
                                        >
                                          <span>添加单个文件</span>
                                          <span className="text-[10px] text-ui-muted opacity-50 font-normal">单个导入</span>
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              ) : (
                                <div className="flex flex-wrap justify-center gap-3">
                                  <Button variant="secondary" onClick={() => void handleChooseDirectories()} disabled={loading} className="h-9 rounded-[6px] border border-on-surface/8 bg-surface px-5 text-[12px] font-bold text-on-surface/70 hover:bg-on-surface/[0.04] hover:text-on-surface active:scale-95 transition-all">
                                    移动整个文件夹
                                  </Button>
                                  <Button variant="secondary" onClick={() => void handleChooseFiles()} disabled={loading} className="h-9 rounded-[6px] border border-on-surface/8 bg-surface px-5 text-[12px] font-bold text-on-surface/70 hover:bg-on-surface/[0.04] hover:text-on-surface active:scale-95 transition-all">
                                    添加单个文件
                                  </Button>
                                </div>
                              )}
                              <p className="max-w-lg text-[11px] font-medium leading-relaxed text-ui-muted/55 text-center px-4">
                                {isDesktopEnvironment ? "“整理文件夹内容”会分析并提取其中的文件；您也可以点击右侧下拉菜单，选择移动整个文件夹或添加单个文件。" : "“移动整个文件夹”会保留文件夹结构本身，“添加单个文件”仅整理选中的文件。"}
                              </p>
                              {isDesktopEnvironment && (
                                <div className="rounded-[6px] border border-on-surface/6 bg-on-surface/[0.015] px-4 py-2 text-[10px] font-mono leading-relaxed text-ui-muted/50 max-w-md text-center mt-1">
                                  * Windows 原生限制：如需单次混选文件与文件夹，请直接拖拽至上方区域 *
                                </div>
                              )}
                            </div>


                            <div className={cn("mt-auto pt-10 flex flex-col items-center gap-5 transition-opacity", isDropActive ? "opacity-10 pointer-events-none" : "opacity-100")}>
                              {commonDirs.length ? (
                                <div className="animate-in fade-in slide-in-from-bottom-2 duration-700 flex flex-col items-center">
                                  <div className="mb-3 flex items-center gap-3">
                                    <div className="h-px w-6 bg-on-surface/5" />
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-ui-muted/30">快捷入口</span>
                                    <div className="h-px w-6 bg-on-surface/5" />
                                  </div>
                                  <div className="flex flex-wrap justify-center gap-2 max-w-2xl px-4">
                                    {commonDirs.slice(0, 5).map((item) => (
                                      <button
                                        key={item.path}
                                        type="button"
                                        disabled={loading}
                                        onClick={() => void importDirectoryEntries(item.path)}
                                        className="group flex items-center gap-2 rounded-full border border-on-surface/6 bg-on-surface/[0.015] px-3 py-1 text-[11px] font-bold text-on-surface/45 transition-all hover:border-primary/20 hover:bg-primary/[0.02] hover:text-primary active:scale-[0.98]"
                                      >
                                        <FolderOpen className="h-3 w-3 opacity-40 group-hover:opacity-100" />
                                        <span className="truncate max-w-[100px]">{item.label || item.path.split(/[\\/]/).pop()}</span>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ) : null}

                              <button
                                type="button"
                                onClick={() => setShowManualInput(!showManualInput)}
                                className="text-[11px] font-bold text-ui-muted opacity-25 hover:text-primary hover:opacity-100 transition-all uppercase tracking-wider"
                              >
                                {showManualInput ? "[ 收起手动输入 ]" : "[ 手动输入路径 ]"}
                              </button>
                            </div>
                          </motion.div>
                        ) : (
                          <div ref={sourceDropZoneRef} className="mt-2 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-on-surface/8 bg-surface-container-lowest px-3 py-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-primary/10 text-primary">
                                  <Layers3 className="h-3.5 w-3.5" />
                                </span>
                                <div className="min-w-0">
                                  <p className="text-[12px] font-black tracking-tight text-on-surface">
                                    已加入 {sourceStats.total} 项
                                  </p>
                                  <p className="text-[10.5px] font-medium text-ui-muted/60">
                                    文件夹已优先显示，方便继续选择是否导入里面的项
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 text-[10.5px] font-black">
                                <span className="rounded-full border border-on-surface/8 bg-surface px-2 py-1 text-on-surface/65">
                                  文件夹 {sourceStats.directoryCount}
                                </span>
                                <span className="rounded-full border border-on-surface/8 bg-surface px-2 py-1 text-on-surface/65">
                                  文件 {sourceStats.fileCount}
                                </span>
                              </div>
                            </div>

                            <motion.div
                              animate={{
                                scale: isDropActive ? 1.01 : 1,
                              }}
                            className={cn(
                                getDropZoneSurfaceClassName({
                                  isActive: isDropActive,
                                  isDraggingGlobal,
                                  idleClassName: "border-on-surface/8 bg-on-surface/[0.015]",
                                  className: "group/add-more flex flex-col items-center justify-center gap-2 rounded-[10px] px-4 py-4 text-on-surface",
                                }),
                              )}
                            >
                              <div className="flex flex-wrap items-center justify-center gap-3">
                                <div className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-on-surface/[0.03] text-on-surface/25 transition-colors group-hover/add-more:bg-primary/10 group-hover/add-more:text-primary">
                                  <Plus className="h-4.5 w-4.5" />
                                </div>
                                <div className="text-center sm:text-left">
                                  <p className="text-[13px] font-black text-on-surface/70 transition-colors group-hover/add-more:text-on-surface">
                                    {isDropActive ? "松手即可继续加入来源" : "继续拖入文件或文件夹"}
                                  </p>
                                  <p className="text-[10.5px] font-medium text-ui-muted/50">
                                    添加入口会保持在列表上方，已加入项可在下方窗口中滑动查看
                                  </p>
                                </div>
                                {isDesktopEnvironment ? (
                                  <button
                                    type="button"
                                    onClick={() => void handleImportDirectoryEntries()}
                                    disabled={loading}
                                    className="rounded-[7px] bg-primary/8 px-3 py-1.5 text-[12px] font-black text-primary hover:bg-primary/12 disabled:opacity-40"
                                  >
                                    整理文件夹内容
                                  </button>
                                ) : null}
                                <div className="flex flex-wrap items-center justify-center gap-2 text-[12px] font-bold text-on-surface/55">
                                  <button type="button" disabled={loading} onClick={() => void handleChooseDirectories()} className="rounded-[6px] px-2.5 py-1 text-on-surface/65 hover:bg-on-surface/[0.04] hover:text-on-surface disabled:opacity-40">移动整个文件夹</button>
                                  <span className="opacity-20">/</span>
                                  <button type="button" disabled={loading} onClick={() => void handleChooseFiles()} className="rounded-[6px] px-2.5 py-1 text-on-surface/65 hover:bg-on-surface/[0.04] hover:text-on-surface disabled:opacity-40">添加单个文件</button>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => setShowManualInput(!showManualInput)}
                                className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant/30 hover:text-primary transition-colors mt-1"
                              >
                                [ 手填路径 ]
                              </button>
                            </motion.div>

                            <div className="overflow-hidden rounded-[10px] border border-on-surface/8 bg-surface-container-lowest">
                              <div className="flex items-center justify-between border-b border-on-surface/6 px-3 py-2">
                              <div className="flex items-center gap-2">
                                  <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-on-surface/5 text-primary">
                                    <ListTree className="h-3.5 w-3.5" />
                                  </span>
                                  <span className="text-[11px] font-black tracking-widest text-ui-muted">已加入来源</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10.5px] font-bold text-ui-muted/55">
                                    文件夹 {sourceStats.directoryCount} · 文件 {sourceStats.fileCount}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={clearAllSources}
                                    disabled={loading || sources.length === 0}
                                    className="inline-flex items-center gap-1 rounded-[6px] border border-on-surface/8 bg-surface px-2.5 py-1 text-[10.5px] font-bold text-on-surface/55 transition-colors hover:border-error/20 hover:bg-error/5 hover:text-error disabled:opacity-40"
                                    title="一键清空当前来源列表"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    清空来源
                                  </button>
                                </div>
                              </div>
                              <div className="max-h-[42vh] min-h-[180px] overflow-y-auto p-2 scrollbar-thin">
                                <div className="grid gap-2">
                                  {(() => {
                                    const renderedGroupIds = new Set<string>();
                                    return displaySources.map((item) => {
                                      const key = sourceSelectionKey(item);
                                      const group = sourceImportGroupByKey.get(key);
                                      if (!group) {
                                        return renderSourceRow(item);
                                      }
                                      if (renderedGroupIds.has(group.group_id)) {
                                        return null;
                                      }
                                      const firstVisibleKey = group.item_keys.find((candidate) => sourceKeyMap.has(candidate));
                                      if (firstVisibleKey !== key) {
                                        return null;
                                      }
                                      renderedGroupIds.add(group.group_id);
                                      const previewItems = group.expanded ? group.items : group.items.slice(0, IMPORT_GROUP_PREVIEW_LIMIT);
                                      const remainingCount = group.items.length - previewItems.length;
                                      return (
                                        <div key={group.group_id} className="rounded-xl border border-primary/20 bg-primary/[0.04] p-3 text-on-surface/80">
                                          <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                              <div className="flex items-center gap-2">
                                                <Layers3 className="h-4 w-4 text-primary/70" />
                                                <p className="text-[13px] font-black tracking-tight text-on-surface">
                                                  已从 {group.source_path.split(/[\\/]/).pop()} 导入 {group.items.length} 项
                                                </p>
                                              </div>
                                              <p className="mt-1 truncate font-mono text-[10px] font-bold text-ui-muted opacity-40 uppercase tracking-widest">
                                                批量导入 · {group.source_path}
                                              </p>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-1.5">
                                              {remainingCount > 0 ? (
                                                <button
                                                  type="button"
                                                  disabled={loading}
                                                  onClick={() => toggleImportGroupExpanded(group.group_id)}
                                                  className="rounded-[6px] px-2 py-1 text-[10.5px] font-bold text-primary transition-colors hover:bg-primary/8"
                                                >
                                                  {group.expanded ? "收起" : `展开其余 ${remainingCount} 项`}
                                                </button>
                                              ) : null}
                                              <button
                                                type="button"
                                                disabled={loading}
                                                onClick={() => removeImportGroup(group.group_id)}
                                                className="rounded-[6px] px-2 py-1 text-[10.5px] font-bold text-error transition-colors hover:bg-error/10"
                                              >
                                                移除整组
                                              </button>
                                            </div>
                                          </div>
                                          <div className="mt-3 grid gap-2">
                                            {previewItems.map((groupItem) => renderSourceRow(groupItem, { nested: true }))}
                                          </div>
                                        </div>
                                      );
                                    });
                                  })()}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {showManualInput && (
                          <div className="mt-4 animate-in fade-in slide-in-from-top-2 duration-200">
                            <div className="flex items-center gap-2 rounded-[8px] border border-on-surface/12 bg-surface-container-lowest p-1">
                              <div className="flex shrink-0 rounded-[6px] border border-on-surface/5 bg-surface p-1">
                                {([
                                  ["directory", "文件夹"],
                                  ["file", "文件"],
                                ] as const).map(([value, label]) => (
                                  <button
                                    key={value}
                                    type="button"
                                    onClick={() => setSourceDraftType(value)}
                                    className={[
                                      "rounded-[4px] px-3 py-1.5 text-[12px] font-bold transition-colors",
                                      sourceDraftType === value ? "bg-primary/10 text-primary" : "text-on-surface-variant/60 hover:text-on-surface",
                                    ].join(" ")}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                              <div className="relative flex-1">
                                <input
                                  value={sourceDraftPath}
                                  onChange={(event) => setSourceDraftPath(event.target.value)}
                                  disabled={loading}
                                  placeholder="输入完整绝对路径..."
                                  className="w-full bg-transparent px-3 py-2 text-[13px] font-medium text-on-surface outline-none placeholder:text-on-surface-variant/40 focus:ring-0"
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') addManualSource();
                                  }}
                                />
                              </div>
                              <button
                                type="button"
                                onClick={addManualSource}
                                disabled={loading || !sourceDraftPath.trim()}
                                className="shrink-0 rounded-[6px] bg-on-surface/5 px-4 py-2 text-[12px] font-bold text-on-surface transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                              >
                                添加
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null}

                    {step === 2 ? (
                      <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <div className="flex items-center gap-2">
                          <div className="flex h-6 w-6 items-center justify-center rounded-[4px] bg-primary/10 text-primary">
                            <Sparkles className="h-3.5 w-3.5" />
                          </div>
                          <h2 className="text-[14px] font-bold text-on-surface">选择整理方式</h2>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          {[
                            {
                              method: "assign_into_existing_categories" as const,
                              title: "归入现有目录",
                              description: "将文件分配至已选定的现有工作目录，未匹配的条目将放入待确认区。",
                            },
                            {
                              method: "categorize_into_new_structure" as const,
                              title: "生成新分类结构",
                              description: "分析文件属性并生成多级分类目录，在指定位置自动创建子文件夹。",
                            },
                          ].map((option) => {
                            const active = organizeMethod === option.method;
                            return (
                              <button
                                key={option.method}
                                type="button"
                                disabled={loading}
                                onClick={() => updateStrategy((previous) => strategyForMethod(previous, option.method))}
                                className={cn(
                                  "rounded-xl border-2 px-4 py-4 text-left transition-all active:scale-[0.98] disabled:opacity-50",
                                  active
                                    ? "border-primary/40 bg-primary/5 ring-1 ring-primary/10"
                                    : "border-on-surface/8 bg-surface-container-lowest hover:border-primary/20",
                                )}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <p className={cn("text-[14.5px] font-black tracking-tight", active ? "text-primary" : "text-on-surface/80")}>{option.title}</p>
                                  {active ? <Sparkles className="h-4 w-4 text-primary" /> : null}
                                </div>
                                <p className="mt-2 text-[12px] font-medium leading-relaxed text-ui-muted opacity-60">{option.description}</p>
                              </button>
                            );
                          })}                      </div>
                      </div>
                    ) : null}

                    {step === 3 ? (
                      <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between gap-3 border-b border-on-surface/10 pb-3">
                            <div className="flex items-center gap-2">
                              <div className="flex h-6 w-6 items-center justify-center rounded-[4px] bg-primary/10 text-primary">
                                <FolderOpen className="h-3.5 w-3.5" />
                              </div>
                              <h2 className="text-[14px] font-bold text-on-surface">默认放置规则</h2>
                            </div>
                            <button
                              type="button"
                              onClick={() => setShowPlacementOverrides((current) => !current)}
                              className="rounded-[6px] border border-on-surface/8 bg-surface px-3 py-1.5 text-[11px] font-bold text-on-surface transition-colors hover:border-primary/20 hover:text-primary"
                            >
                              {showPlacementOverrides ? "收起" : "修改放置规则"}
                            </button>
                          </div>
                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="rounded-[8px] bg-surface-container-lowest px-3 py-3">
                              <div className="mb-1 text-[11px] font-bold text-on-surface">
                                {isAssignExisting ? "未匹配条目默认根路径" : "新目录生成位置"}
                              </div>
                              <div className="break-all text-[12px] font-medium text-ui-muted">{effectiveNewDirectoryRoot || "尚未确定"}</div>
                            </div>
                            <div className="rounded-[8px] bg-surface-container-lowest px-3 py-3">
                              <div className="mb-1 text-[11px] font-bold text-on-surface">待确认区路径</div>
                              <div className="break-all text-[12px] font-medium text-ui-muted">{effectiveReviewRoot || "尚未确定"}</div>
                            </div>
                          </div>
                          {showPlacementOverrides ? (
                            <div className="mt-4 grid gap-4 xl:grid-cols-2">
                              <div className="rounded-[8px] border border-on-surface/8 bg-surface-container-lowest p-4">
                                <div className="mb-3 text-[12px] font-bold text-on-surface">
                                  {isAssignExisting ? "未匹配条目默认根路径" : "新目录生成位置"}
                                </div>
                                <div className="flex gap-3">
                                  <input
                                    value={newDirectoryRoot}
                                    onChange={(event) => setNewDirectoryRoot(event.target.value)}
                                    disabled={loading}
                                    placeholder={placementConfig.defaultNewDirectoryRoot || (isFullCategorize ? "新目录生成路径" : "当前任务工作区")}
                                    className="h-10 flex-1 rounded-[8px] border border-transparent bg-on-surface/[0.03] px-3 text-[13px] font-medium text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary/40 focus:bg-surface focus:ring-4 focus:ring-primary/10"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => void handleSelectPlacementRoot("new")}
                                    disabled={loading}
                                    className="h-10 rounded-[8px] border border-on-surface/8 bg-surface px-4 text-[12px] font-bold text-on-surface transition-colors hover:border-primary/20 hover:text-primary disabled:opacity-50"
                                  >
                                    选择目录
                                  </button>
                                </div>
                                <p className="mt-2 text-[11px] font-medium text-ui-muted">
                                  {isAssignExisting
                                    ? "此路径用于存放未匹配的条目。留空时使用系统默认设置；若无全局默认设置，将根据任务类型自动生成。"
                                    : "留空时使用系统默认设置；若无全局默认设置，将根据任务类型自动生成。"}
                                </p>
                              </div>
                              <div className="rounded-[8px] border border-on-surface/8 bg-surface-container-lowest p-4">
                                <div className="mb-3 flex items-center justify-between gap-3">
                                  <div className="text-[12px] font-bold text-on-surface">待确认区路径</div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setReviewFollowsNewRoot((current) => {
                                        const next = !current;
                                        if (next) setReviewRoot("");
                                        return next;
                                      });
                                    }}
                                    className={[
                                      "rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors",
                                      reviewFollowsNewRoot
                                        ? "border-primary/20 bg-primary/10 text-primary"
                                        : "border-on-surface/8 bg-surface text-ui-muted",
                                    ].join(" ")}
                                  >
                                    {reviewFollowsNewRoot ? "跟随新目录" : "独立设置"}
                                  </button>
                                </div>
                                <div className="flex gap-3">
                                  <input
                                    value={reviewFollowsNewRoot ? "" : reviewRoot}
                                    onChange={(event) => {
                                      setReviewRoot(event.target.value);
                                      setReviewFollowsNewRoot(false);
                                    }}
                                    disabled={loading || reviewFollowsNewRoot}
                                    placeholder={reviewFollowsNewRoot ? derivedReviewRoot || "跟随新目录路径自动生成" : placementConfig.globalReviewRoot || derivedReviewRoot || "独立指定待确认区路径"}
                                    className="h-10 flex-1 rounded-[8px] border border-transparent bg-on-surface/[0.03] px-3 text-[13px] font-medium text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary/40 focus:bg-surface focus:ring-4 focus:ring-primary/10 disabled:opacity-60"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => void handleSelectPlacementRoot("review")}
                                    disabled={loading || reviewFollowsNewRoot}
                                    className="h-10 rounded-[8px] border border-on-surface/8 bg-surface px-4 text-[12px] font-bold text-on-surface transition-colors hover:border-primary/20 hover:text-primary disabled:opacity-50"
                                  >
                                    选择目录
                                  </button>
                                </div>
                                <p className="mt-2 text-[11px] font-medium text-ui-muted">
                                  默认跟随新目录根路径生成 Review 子目录，不再创建更深层级的目录结构。
                                </p>
                              </div>
                            </div>
                          ) : null}
                        </div>

                        {isAssignExisting ? (
                          <div 
                            ref={targetDropZoneRef}
                            onDrop={handleTargetDrop}
                            onDragOver={handleTargetDragOver}
                            onDragLeave={handleTargetDragLeave}
                            className={getDropZoneSurfaceClassName({
                              isActive: isTargetDropActive,
                              isDraggingGlobal,
                              idleClassName: "border-on-surface/8 bg-surface",
                              className: "relative overflow-hidden rounded-[8px] p-4",
                            })}
                          >
                            {isTargetDropActive && (
                              <DropZoneOverlay
                                icon={FolderPlus}
                                title="松手即可添加为目标候选"
                                detail="这里只接受文件夹，文件会被自动忽略"
                                className="inset-0 rounded-[8px]"
                              />
                            )}
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <div className="flex h-6 w-6 items-center justify-center rounded-[4px] bg-primary/10 text-primary">
                                  <Layers3 className="h-3.5 w-3.5" />
                                </div>
                                <h2 className="text-[14px] font-bold text-on-surface">目标目录</h2>
                              </div>
                              {targetProfilesLoading ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : null}
                            </div>

                            <div className="mb-4">
                              <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-ui-muted">已有目录配置</div>
                              <select
                                value={selectedTargetProfileId}
                                onChange={(event) => setSelectedTargetProfileId(event.target.value)}
                                disabled={loading || targetProfilesLoading}
                                className="h-10 w-full rounded-[8px] border border-transparent bg-on-surface/[0.03] px-3 text-[13px] font-medium text-on-surface outline-none transition-all focus:border-primary/40 focus:bg-surface focus:ring-4 focus:ring-primary/10"
                              >
                                <option value="">不使用已保存配置</option>
                                {targetProfiles.map((profile) => (
                                  <option key={profile.profile_id} value={profile.profile_id}>
                                    {profile.name}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="space-y-2">
                              <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-ui-muted">补充目标目录</div>

                              {effectiveTargetDirectories.length > 0 && (
                                <div className="grid gap-2">
                                  {effectiveTargetDirectories.map((item) => {
                                    const isFromProfile = profileDirectories.some((p) => pathKey(p.path) === pathKey(item.path));
                                    const editorKey = targetDirectoryEditorKey(item.path);
                                    const isExpanded = expandedTargetDirectoryEditors[editorKey] ?? false;
                                    const hasSemanticHint = Boolean((item.label || "").trim() || (item.description || "").trim());
                                    return (
                                      <div
                                        key={item.path}
                                        className="group rounded-lg border border-on-surface/12 bg-surface-container-lowest px-3 py-3 transition-all hover:border-on-surface/20 active:scale-[0.99]"
                                      >
                                        <div className="flex items-start justify-between gap-3">
                                          <div className="flex min-w-0 items-start gap-3">
                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                                              <FolderOpen className="h-4.5 w-4.5" />
                                            </div>
                                            <div className="min-w-0">
                                              <div className="flex items-center gap-2">
                                                <span className="truncate text-[14px] font-black tracking-tight text-on-surface">{item.label || item.path.split(/[\\/]/).pop() || item.path}</span>
                                                {isFromProfile && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-black uppercase text-primary tracking-widest leading-none">已保存</span>}
                                              </div>
                                              <div className="truncate font-mono text-[10.5px] font-medium text-ui-muted opacity-40 uppercase tracking-tighter" title={item.path}>{item.path}</div>
                                              {item.label ? (
                                                <div className="mt-1 inline-flex rounded-[5px] bg-primary/[0.06] px-2 py-0.5 text-[10px] font-bold text-primary">
                                                  标签：{item.label}
                                                </div>
                                              ) : null}
                                              {item.description ? (
                                                <div className="mt-1 text-[11px] font-medium leading-relaxed text-ui-muted">
                                                  {item.description}
                                                </div>
                                              ) : !item.label ? (
                                                <div className="mt-1 text-[11px] font-medium leading-relaxed text-ui-muted/55">
                                                  暂未补充标签和目录说明。
                                                </div>
                                              ) : null}
                                            </div>
                                          </div>
                                          <div className="flex shrink-0 items-center gap-2">
                                            <button
                                              type="button"
                                              onClick={() => setExpandedTargetDirectoryEditors((current) => ({ ...current, [editorKey]: !isExpanded }))}
                                              disabled={loading}
                                              className="rounded-[6px] px-2 py-1 text-[11px] font-bold text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                                            >
                                              {hasSemanticHint ? "编辑标签和说明" : "补充标签和说明"}
                                            </button>
                                            {!isFromProfile && (
                                              <button
                                                type="button"
                                                onClick={() => removeManualTargetDirectory(item.path)}
                                                disabled={loading}
                                                className="shrink-0 rounded-md p-2 text-on-surface-variant/40 transition-all hover:bg-error/10 hover:text-error opacity-0 group-hover:opacity-100 focus:opacity-100 active:scale-90"
                                                title="移除"
                                              >
                                                <Trash2 className="h-4 w-4" />
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                        {isExpanded ? (
                                          <div className="mt-3 grid gap-2 xl:grid-cols-[220px_minmax(0,1fr)]">
                                            <input
                                              value={item.label || ""}
                                              onChange={(event) => updateTargetDirectoryDraft(item.path, { label: event.target.value })}
                                              disabled={loading}
                                              placeholder="标签（可选）"
                                              className="h-9 rounded-[8px] border border-on-surface/8 bg-surface px-3 text-[12px] text-on-surface outline-none focus:border-primary/40"
                                            />
                                            <input
                                              value={item.description || ""}
                                              onChange={(event) => updateTargetDirectoryDraft(item.path, { description: event.target.value })}
                                              disabled={loading}
                                              placeholder="目录说明（可选，用来提示这个目录适合收什么）"
                                              className="h-9 rounded-[8px] border border-on-surface/8 bg-surface px-3 text-[12px] text-on-surface outline-none focus:border-primary/40"
                                            />
                                          </div>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}

                              <div







                                className="flex flex-col items-center justify-center rounded-[10px] border border-dashed border-on-surface/10 bg-surface-container-lowest px-4 py-6 transition-all duration-300 sm:flex-row sm:justify-between sm:py-2.5 hover:border-on-surface/20"







                              >
                                <div className="flex items-center gap-2 text-[13px] font-bold text-on-surface/60 mb-3 sm:mb-0">
                                  <Plus className="hidden h-4 w-4 text-on-surface/20 sm:block" />
                                  拖拽文件夹作为目标候选，或者
                                  <button type="button" onClick={() => void handleAddTargetDirectories()} className="mx-1 font-black text-primary hover:underline underline-offset-4 decoration-2">点击选择</button>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setShowManualTargetInput(!showManualTargetInput)}
                                  className="text-[11px] font-black uppercase tracking-wider text-ui-muted opacity-30 hover:text-primary hover:opacity-100 transition-colors"
                                >
                                  {showManualTargetInput ? "[ 收起手动输入 ]" : "[ 手填路径 ]"}
                                </button>
                              </div>

                              {showManualTargetInput && (
                                <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                                  <div className="flex gap-3">
                                    <input
                                      value={targetDirectoryDraft}
                                      onChange={(event) => setTargetDirectoryDraft(event.target.value)}
                                      disabled={loading}
                                      placeholder="手动输入目标目录完整绝对路径"
                                      className="h-10 flex-1 rounded-[8px] border border-transparent bg-on-surface/[0.03] px-3 text-[13px] font-medium text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary/40 focus:bg-surface focus:ring-4 focus:ring-primary/10"
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') addManualTargetDirectory();
                                      }}
                                    />
                                    <button
                                      type="button"
                                      onClick={addManualTargetDirectory}
                                      disabled={loading || !targetDirectoryDraft.trim()}
                                      className="h-10 rounded-[8px] bg-on-surface/5 px-4 text-[12px] font-bold text-on-surface transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                                    >
                                      添加
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>


                          </div>
                        ) : null}

                        {isAssignExisting && effectiveTargetDirectories.length > 0 ? (
                          <div className="space-y-3 pt-2">
                            <div className="flex items-center justify-between gap-3 border-b border-on-surface/10 pb-3">
                              <div>
                                <h2 className="text-[14px] font-bold text-on-surface">把这次目录组合保存为常用配置</h2>
                                <p className="mt-1 text-[11px] font-medium leading-relaxed text-ui-muted">
                                  若该组目录是常用候选库，保存配置可避免下次繁琐拖拽。
                                </p>
                              </div>
                            </div>
                            <div className="flex gap-3 px-1">
                              <input
                                value={profileNameDraft}
                                onChange={(event) => setProfileNameDraft(event.target.value)}
                                disabled={loading}
                                placeholder="配置名称（例：工作资料库）"
                                className="h-10 flex-1 rounded-[8px] border border-transparent bg-on-surface/[0.03] px-3 text-[13px] font-medium text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary/40 focus:bg-surface focus:ring-4 focus:ring-primary/10"
                              />
                              <button
                                type="button"
                                onClick={() => void handleSaveCurrentDirectoriesAsProfile()}
                                disabled={loading || effectiveTargetDirectories.length === 0}
                                className="h-10 rounded-[8px] bg-on-surface/5 px-4 text-[12px] font-bold text-on-surface transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                              >
                                保存配置
                              </button>
                            </div>
                          </div>
                        ) : null}

                        <div className={cn("grid gap-4", isFullCategorize ? "md:grid-cols-2" : "grid-cols-1")}>
                          {/* 高级设置 */}
                          <div className="rounded-[8px] bg-surface-container-lowest p-4 flex flex-col justify-between min-h-[120px]">
                            <div>
                              <h2 className="text-[14px] font-bold text-on-surface">高级设置</h2>
                              <p className="mt-1 text-[11px] font-medium text-ui-muted">
                                微调分类模板、语言及分类粒度等参数。
                              </p>
                            </div>
                            <div className="mt-3 flex justify-end">
                              <button
                                type="button"
                                onClick={() => setAdvancedSettingsDialogOpen(true)}
                                className="shrink-0 rounded-[6px] border border-on-surface/10 bg-surface px-4 py-1.5 text-[12px] font-bold text-on-surface transition-colors hover:border-primary/20 hover:text-primary"
                              >
                                打开高级设置
                              </button>
                            </div>
                          </div>

                          {/* 预计生成分类 */}
                          {isFullCategorize ? (
                            <div className="rounded-[8px] bg-surface-container-lowest p-4 flex flex-col justify-between min-h-[120px]">
                              <div>
                                <div className="mb-2 text-[14px] font-bold text-on-surface">预计生成分类</div>
                                <div className="flex flex-wrap gap-1.5 max-h-[52px] overflow-y-auto">
                                  {currentSummary.preview_directories?.map((directory) => (
                                    <span
                                      key={`${strategy.template_id}-${strategy.language}-${strategy.density}-${strategy.prefix_style}-${directory}`}
                                      className="rounded-[6px] border border-on-surface/10 bg-primary/5 text-primary px-2.5 py-0.5 text-[11.5px] font-semibold"
                                    >
                                      {directory}
                                    </span>
                                  ))}
                                </div>
                              </div>
                              <p className="mt-2 text-[11px] font-medium leading-relaxed text-ui-muted truncate" title={currentTemplate.description}>
                                {currentTemplate.description}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {/* Desktop Action Bar */}
                    <div className="sticky bottom-0 z-20 mt-3 flex items-center justify-between border-t border-on-surface/10 bg-surface/90 pt-4 pb-6 backdrop-blur-md">
                      {step > 1 ? (
                        <Button
                          variant="secondary"
                          onClick={() => setStep((current) => (Math.max(1, current - 1) as 1 | 2 | 3))}
                          disabled={loading}
                          className="h-10 px-6 font-bold"
                        >
                          返回上一步
                        </Button>
                      ) : (
                        <div />
                      )}

                      {step === 1 ? (
                        <Button
                          variant="primary"
                          onClick={skipStrategyPrompt ? () => void launchCurrentRequest(true, { directStart: true }) : goToStepTwo}
                          disabled={loading || sources.length === 0}
                          className="h-10 px-8 font-bold border border-primary/20 bg-primary"
                        >
                          {loading ? "正在启动..." : skipStrategyPrompt ? fastStartLabel : "下一步：选择整理方式"}
                        </Button>
                      ) : step === 2 ? (
                        <Button
                          variant="primary"
                          onClick={goToStepThree}
                          disabled={loading}
                          className="h-10 px-8 font-bold border border-primary/20 bg-primary"
                        >
                          下一步：填写必要信息
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          onClick={() => void launchCurrentRequest(true)}
                          disabled={loading || !textModelConfigured}
                          loading={loading}
                          className="h-10 min-w-[200px] px-8 font-bold border border-primary/20 bg-primary"
                        >
                          {loading ? "正在启动..." : primaryLaunchLabel}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>

        </div>
      </div>

      <ResumePromptDialog
        open={Boolean(resumePrompt)}
        targetDir={resumePrompt?.launch.display_path || ""}
        resumePrompt={resumePrompt ? { sessionId: resumePrompt.sessionId, snapshot: resumePrompt.snapshot } : null}
        resumeStrategy={resumeStrategy}
        isCompletedResume={isCompletedResume}
        onConfirmResume={handleConfirmResume}
        onStartFresh={() => void handleStartFresh()}
        onReadOnlyView={handleReadOnlyView}
        onCancel={handleCancelResume}
      />

      <Dialog open={advancedSettingsDialogOpen} onOpenChange={setAdvancedSettingsDialogOpen}>
        <DialogContent className="max-w-[920px]">
          <DialogHeader>
            <DialogTitle>高级设置</DialogTitle>
            <DialogDescription>
              这里用于启动前微调模板、风格、目录深度、归档倾向和补充说明。关闭后会保留你已经改过的草稿。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 max-h-[70vh] overflow-y-auto pr-1">
            {!isAssignExisting ? (
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-[8px] border border-on-surface/8 bg-surface-container-lowest p-4">
                  <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-ui-muted">默认模板</div>
                  <div className="grid gap-2">
                    {STRATEGY_TEMPLATES.map((template) => {
                      const active = strategy.template_id === template.id;
                      return (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => updateStrategy((previous) => ({ ...previous, template_id: template.id, ...getSuggestedSelection(template.id) }))}
                          disabled={loading}
                          className={[
                            "rounded-[8px] border px-3 py-2.5 text-left transition-all disabled:opacity-50",
                            active
                              ? "border-primary/25 bg-primary/10"
                              : "border-on-surface/8 bg-surface hover:border-primary/20 hover:bg-surface-container-low",
                          ].join(" ")}
                        >
                          <p className={active ? "text-[12.5px] font-bold text-primary" : "text-[12.5px] font-bold text-on-surface"}>{template.label}</p>
                          <p className="mt-0.5 text-[11px] leading-[1.5] text-ui-muted/80">{template.description}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="rounded-[8px] border border-on-surface/8 bg-surface-container-lowest p-4">
                  <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-ui-muted">目录语言</div>
                  <div className="grid gap-2">
                    {LANGUAGE_OPTIONS.map((option) => {
                      const active = strategy.language === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => updateStrategy((previous) => ({ ...previous, language: option.id }))}
                          disabled={loading}
                          className={[
                            "rounded-[8px] border px-3 py-2.5 text-left transition-all disabled:opacity-50",
                            active
                              ? "border-primary/25 bg-primary/10"
                              : "border-on-surface/8 bg-surface hover:border-primary/20 hover:bg-surface-container-low",
                          ].join(" ")}
                        >
                          <p className={active ? "text-[12.5px] font-bold text-primary" : "text-[12.5px] font-bold text-on-surface"}>{option.label}</p>
                          <p className="mt-0.5 text-[11px] leading-[1.5] text-ui-muted/80">{option.description}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="rounded-[8px] border border-on-surface/8 bg-surface-container-lowest p-4">
                  <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-ui-muted">分类粒度</div>
                  <div className="grid gap-2">
                    {DENSITY_OPTIONS.map((option) => {
                      const active = strategy.density === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => updateStrategy((previous) => ({ ...previous, density: option.id }))}
                          disabled={loading}
                          className={[
                            "rounded-[8px] border px-3 py-2.5 text-left transition-all disabled:opacity-50",
                            active
                              ? "border-primary/25 bg-primary/10"
                              : "border-on-surface/8 bg-surface hover:border-primary/20 hover:bg-surface-container-low",
                          ].join(" ")}
                        >
                          <p className={active ? "text-[12.5px] font-bold text-primary" : "text-[12.5px] font-bold text-on-surface"}>{option.label}</p>
                          <p className="mt-0.5 text-[11px] leading-[1.5] text-ui-muted/80">{option.description}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="rounded-[8px] border border-on-surface/8 bg-surface-container-lowest p-4">
                  <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-ui-muted">目录前缀</div>
                  <div className="grid gap-2">
                    {PREFIX_STYLE_OPTIONS.map((option) => {
                      const active = strategy.prefix_style === option.id;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => updateStrategy((previous) => ({ ...previous, prefix_style: option.id }))}
                          disabled={loading}
                          className={[
                            "rounded-[8px] border px-3 py-2.5 text-left transition-all disabled:opacity-50",
                            active
                              ? "border-primary/25 bg-primary/10"
                              : "border-on-surface/8 bg-surface hover:border-primary/20 hover:bg-surface-container-low",
                          ].join(" ")}
                        >
                          <p className={active ? "text-[12.5px] font-bold text-primary" : "text-[12.5px] font-bold text-on-surface"}>{option.label}</p>
                          <p className="mt-0.5 text-[11px] leading-[1.5] text-ui-muted/80">{option.description}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="rounded-[8px] border border-on-surface/8 bg-surface-container-lowest p-4">
              <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-ui-muted">归档倾向</div>
              <div className="grid gap-2 xl:grid-cols-2">
                {CAUTION_LEVEL_OPTIONS.map((option) => {
                  const active = strategy.caution_level === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => updateStrategy((previous) => ({ ...previous, caution_level: option.id }))}
                      disabled={loading}
                      className={[
                        "rounded-[8px] border px-3 py-2.5 text-left transition-all disabled:opacity-50",
                        active
                          ? "border-primary/25 bg-primary/10"
                          : "border-on-surface/8 bg-surface hover:border-primary/20 hover:bg-surface-container-low",
                      ].join(" ")}
                    >
                      <p className={active ? "text-[12.5px] font-bold text-primary" : "text-[12.5px] font-bold text-on-surface"}>{option.label}</p>
                      <p className="mt-0.5 text-[11px] leading-[1.5] text-ui-muted/80">{option.description}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-[8px] border border-on-surface/8 bg-surface-container-lowest p-4">
              <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.15em] text-ui-muted">补充说明</div>
              <textarea
                value={strategy.note}
                disabled={loading}
                onChange={(event) => updateStrategy((previous) => ({ ...previous, note: event.target.value.slice(0, 200) }))}
                placeholder={isAssignExisting ? "例如：拿不准的先放待确认区；优先归入现有项目目录。" : "例如：课程资料按学期整理；图片素材按用途分层。"}
                className="min-h-[96px] w-full resize-none rounded-[10px] border border-on-surface/8 bg-surface px-4 py-3 text-[13px] leading-relaxed text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary/30"
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
