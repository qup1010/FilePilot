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
  ChevronLeft,
  ShieldAlert,
  X,
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
  const [showClearConfirm, setShowClearConfirm] = useState(false);
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

  const renderMethodExplanation = () => {
    const isAssign = organizeMethod === "assign_into_existing_categories";
    return (
      <div className="mt-6 rounded-xl border border-on-surface/5 bg-on-surface/[0.01] p-4 space-y-3.5 animate-in fade-in duration-300">
        <div className="text-[12px] font-bold text-on-surface flex items-center gap-1.5 border-b border-on-surface/[0.04] pb-2">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          <span>所选方式整理逻辑</span>
        </div>
        {isAssign ? (
          <div className="space-y-2.5 text-[12px] text-ui-muted leading-relaxed">
            <p>
              <strong>工作机制：</strong>扫描来源文件，与您指定的已有目标文件夹（如工作资料库、各项目目录）进行名称和内容的比对分配。
            </p>
            <p>
              <strong>未匹配规则：</strong>如果文件无法明确归入任何目标目录，会被统一放入“待确认区（Review）”，不会强制乱放或自动创建未知文件夹。
            </p>
            <p className="text-[11px] font-medium opacity-60">
              适用场景：已有建立好、边界清晰的分类目录，只需将零乱新文件精准归档入库。
            </p>
          </div>
        ) : (
          <div className="space-y-2.5 text-[12px] text-ui-muted leading-relaxed">
            <p>
              <strong>工作机制：</strong>AI 全自动分析所有文件的主题、类型和关联度，在指定的根目录下为您自动构建多级全新的分类子文件夹。
            </p>
            <p>
              <strong>待确认规则：</strong>无法合理归纳的文件会被归入“待确认区（Review）”目录，不会遗失，方便您后续手动调整。
            </p>
            <p className="text-[11px] font-medium opacity-60">
              适用场景：面临杂乱无章、没有预设分类的大量文件，希望能一键自动生成一套逻辑清晰的新目录结构。
            </p>
          </div>
        )}
      </div>
    );
  };;

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

  function handleClearSourcesWithConfirm() {
    if (showClearConfirm) {
      clearAllSources();
      setShowClearConfirm(false);
    } else {
      setShowClearConfirm(true);
    }
  }

  useEffect(() => {
    if (!showClearConfirm) return;
    const timer = setTimeout(() => {
      setShowClearConfirm(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [showClearConfirm]);

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
          "group flex items-center justify-between gap-3 transition-all active:scale-[0.995]",
          nested
            ? "rounded-md border border-on-surface/6 bg-surface px-2.5 py-1.5 hover:border-on-surface/16"
            : "rounded-lg border border-on-surface/8 bg-surface-container-lowest px-3 py-2 hover:border-on-surface/20",
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <div className={cn(
            "flex shrink-0 items-center justify-center rounded bg-primary/10 text-primary",
            nested ? "h-7.5 w-7.5" : "h-8.5 w-8.5",
          )}>
            {isDirectory ? (
              <FolderOpen className={cn("text-primary", nested ? "h-3.5 w-3.5" : "h-4 w-4")} />
            ) : (
              <FileText className={cn("text-primary", nested ? "h-3.5 w-3.5" : "h-4 w-4")} />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn("truncate font-black tracking-tight text-on-surface", nested ? "text-[12.5px]" : "text-[13.5px]")}>
                {item.path.split(/[\\/]/).pop() || item.path}
              </span>
              <span className="shrink-0 rounded bg-on-surface/5 px-1 py-0.2 text-[8px] font-black uppercase tracking-wider text-ui-muted opacity-80 scale-90 origin-left">
                {getSourceBehaviorLabel(item)}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 leading-none">
              <span className="truncate font-mono text-[9.5px] font-medium text-ui-muted opacity-40 uppercase tracking-tighter max-w-[280px] sm:max-w-[400px]" title={item.path}>
                {item.path}
              </span>
              {isDirectory && (
                <>
                  <span className="text-[9px] text-ui-muted opacity-25 select-none">·</span>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      if (isAtomic) {
                        void handleImportFromSource(item);
                      } else {
                        updateDirectorySourceMode(item.path, "atomic");
                      }
                    }}
                    className="shrink-0 text-[9.5px] font-bold text-primary hover:underline transition-colors leading-none"
                  >
                    {isAtomic ? "导入内部项" : "改为整体移动"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => removeSource(item.path, item.source_type)}
          disabled={loading}
          className="shrink-0 rounded-[4px] p-1.5 text-on-surface-variant/40 transition-colors hover:bg-error/10 hover:text-error opacity-0 group-hover:opacity-100 focus:opacity-100"
          title="移除"
        >
          <Trash2 className="h-4 w-4" />
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

  function handleStepClick(targetId: 1 | 2 | 3) {
    if (loading) return;
    if (targetId === step) return;

    if (targetId < step) {
      setError(null);
      setStep(targetId);
      return;
    }

    if (!validateStepOne()) return;

    setError(null);
    setStep(targetId);
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
              <p className="mt-1 text-[11.5px] font-medium leading-relaxed text-ui-muted/60">为新建的文件夹匹配并应用图标，提升视觉辨识度。</p>
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

              <AnimatePresence>
                {!error && sourceFeedback ? (
                  <motion.div
                    initial={{ opacity: 0, y: 15, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.98 }}
                    transition={{ duration: 0.2 }}
                    className={cn(
                      "fixed bottom-6 right-6 z-50 flex w-[350px] items-start gap-3 rounded-lg border p-3.5 shadow-[0_8px_32px_rgba(0,0,0,0.12)] backdrop-blur-md pointer-events-auto",
                      sourceFeedback.tone === "success"
                        ? "border-success/20 bg-surface/90 dark:bg-surface-container-dark/90 text-on-surface"
                        : "border-primary/15 bg-surface/90 dark:bg-surface-container-dark/90 text-on-surface",
                    )}
                  >
                    <div className={cn(
                      "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                      sourceFeedback.tone === "success" ? "bg-success/10 text-success" : "bg-primary/10 text-primary",
                    )}>
                      {sourceFeedback.tone === "success" ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <Layers3 className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-black leading-tight text-on-surface">
                        {sourceFeedback.tone === "success" ? "来源已更新" : "导入提示"}
                      </p>
                      <p className="mt-1.5 text-[11.5px] font-medium leading-relaxed text-ui-muted opacity-80">{sourceFeedback.message}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSourceFeedback(null)}
                      className="p-1 rounded transition-colors active:scale-95 shrink-0 self-start mt-0.5 text-on-surface/40 hover:bg-on-surface/5 hover:text-on-surface"
                      title="关闭提示"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </motion.div>
                ) : null}
              </AnimatePresence>

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
                {/* Desktop Native Header & Stepper */}
                <div className="relative mb-3 flex items-center justify-center border-b border-on-surface/5 pb-4 pt-1 w-full min-h-[44px]">
                  <button
                    type="button"
                    onClick={() => setLaunchFlowOpen(false)}
                    className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[11px] font-black text-ui-muted hover:text-primary hover:bg-primary/5 rounded-[6px] px-2.5 py-1.5 transition-all active:scale-[0.97]"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    <span>返回</span>
                  </button>

                  <div className="flex items-center justify-center gap-2">
                    {stepItems.map((item, index) => {
                      const active = step === item.id;
                      const completed = step > item.id;

                      return (
                        <div key={item.id} className="flex items-center">
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => handleStepClick(item.id)}
                            className={cn(
                              "flex items-center gap-2.5 rounded-full px-3 py-1.5 transition-all duration-300 disabled:opacity-50",
                              active
                                ? "bg-primary/10 ring-1 ring-primary/20 cursor-default"
                                : "bg-transparent hover:bg-on-surface/6 cursor-pointer active:scale-[0.98]"
                            )}
                          >
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
                              "text-[13px] font-black tracking-tight transition-colors duration-200",
                              active
                                ? "text-primary"
                                : completed
                                  ? "text-on-surface/80 hover:text-primary"
                                  : "text-on-surface/40 hover:text-on-surface/70"
                            )}>
                              {item.title}
                            </span>
                          </button>
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
                        {sources.length === 0 && (
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
                        )}
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
                                draggingClassName: "border-primary/30 bg-primary/[0.015]",
                                activeClassName: "border-primary/45 bg-primary/8 text-primary ring-1 ring-primary/15",
                                className: "group mt-1 flex flex-col items-center justify-center rounded-[8px] px-6 py-8 text-center transition-all duration-300 relative overflow-hidden",
                              }),
                              isDropActive && "shadow-lg shadow-primary/10 ring-2 ring-primary/20 border-primary/30 bg-primary/[0.01]"
                            )}
                          >
                            {isDropActive && (
                              <DropZoneOverlay
                                icon={Upload}
                                title="松手即可添加为整理来源"
                                detail="支持拖入文件夹或单个文件"
                                className="inset-0 rounded-[8px]"
                              />
                            )}
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
                            <div className={cn("mt-6 flex flex-col items-center gap-3.5 transition-opacity", isDropActive ? "opacity-20 pointer-events-none" : "opacity-100")}>
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
                                  <Button
                                    variant="secondary"
                                    onClick={() => void handleChooseDirectories()}
                                    disabled={loading}
                                    className="h-9 rounded-[6px] border border-on-surface/8 bg-surface px-5 text-[12px] font-bold text-on-surface/70 hover:bg-on-surface/[0.04] hover:text-on-surface active:scale-95 transition-all"
                                  >
                                    移动整个文件夹
                                  </Button>
                                  <Button
                                    variant="secondary"
                                    onClick={() => void handleChooseFiles()}
                                    disabled={loading}
                                    className="h-9 rounded-[6px] border border-on-surface/8 bg-surface px-5 text-[12px] font-bold text-on-surface/70 hover:bg-on-surface/[0.04] hover:text-on-surface active:scale-95 transition-all"
                                  >
                                    添加单个文件
                                  </Button>
                                </div>
                              )}
                              <p className="max-w-lg text-[11px] font-medium leading-relaxed text-ui-muted/55 text-center px-4">
                                {isDesktopEnvironment
                                  ? "“整理文件夹内容”会分析并提取其中的文件；您也可以点击右侧下拉菜单，选择移动整个文件夹或添加单个文件。"
                                  : "“移动整个文件夹”会保留文件夹结构本身，“添加单个文件”仅整理选中的文件。"}
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
                            <motion.div
                              animate={{
                                scale: isDropActive ? 1.005 : 1,
                              }}
                              className={cn(
                                getDropZoneSurfaceClassName({
                                  isActive: isDropActive,
                                  isDraggingGlobal,
                                  idleClassName: "border-on-surface/8 bg-on-surface/[0.01] hover:bg-on-surface/[0.02] border-dashed",
                                  draggingClassName: "border-primary/25 bg-primary/[0.01]",
                                  activeClassName: "border-primary/45 bg-primary/8 text-primary ring-1 ring-primary/15",
                                  className: "group/add-more flex flex-wrap items-center justify-between gap-3 rounded-[8px] px-3 py-1.5 text-on-surface transition-all duration-300 relative overflow-hidden",
                                }),
                                isDropActive && "shadow-lg shadow-primary/5 ring-1 ring-primary/10 border-primary/20 bg-primary/[0.01]"
                              )}
                            >
                              {isDropActive && (
                                <DropZoneOverlay
                                  icon={Plus}
                                  title="松手以追加整理来源"
                                  detail=""
                                  className="inset-0 rounded-[8px]"
                                  panelClassName="flex-row gap-2 py-0"
                                  iconWrapClassName="h-6 w-6 rounded-[6px]"
                                  titleClassName="text-[11.5px] font-black tracking-normal"
                                />
                              )}
                              <div className="flex items-center gap-2 min-w-0">
                                <Plus className={cn("h-4 w-4 shrink-0 transition-colors", isDropActive ? "text-primary animate-pulse" : "text-ui-muted/40 group-hover/add-more:text-primary/70")} />
                                <span className={cn("text-[11.5px] font-bold truncate", isDropActive ? "text-primary" : "text-ui-muted opacity-55")}>
                                  {isDropActive ? "松手即可继续加入" : "拖入文件或文件夹以追加来源"}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 text-[11px] font-bold text-on-surface/50">
                                {isDesktopEnvironment && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => void handleImportDirectoryEntries()}
                                      disabled={loading}
                                      className="rounded px-2 py-1 text-primary hover:bg-primary/8 transition-colors disabled:opacity-40"
                                    >
                                      整理文件夹内容
                                    </button>
                                    <span className="text-on-surface/10 font-normal select-none">|</span>
                                  </>
                                )}
                                <button
                                  type="button"
                                  disabled={loading}
                                  onClick={() => void handleChooseDirectories()}
                                  className="rounded px-2 py-1 hover:bg-on-surface/[0.04] hover:text-on-surface transition-colors disabled:opacity-40"
                                >
                                  移动文件夹
                                </button>
                                <span className="text-on-surface/10 font-normal select-none">|</span>
                                <button
                                  type="button"
                                  disabled={loading}
                                  onClick={() => void handleChooseFiles()}
                                  className="rounded px-2 py-1 hover:bg-on-surface/[0.04] hover:text-on-surface transition-colors disabled:opacity-40"
                                >
                                  单个文件
                                </button>
                                <span className="text-on-surface/10 font-normal select-none">|</span>
                                <button
                                  type="button"
                                  onClick={() => setShowManualInput(!showManualInput)}
                                  className={cn("rounded px-2 py-1 transition-colors", showManualInput ? "text-primary bg-primary/5" : "hover:bg-on-surface/[0.04] hover:text-on-surface")}
                                >
                                  手填路径
                                </button>
                              </div>
                            </motion.div>

                            <div className="overflow-hidden rounded-[10px] border border-on-surface/8 bg-surface-container-lowest">
                              <div className="flex items-center justify-between border-b border-on-surface/6 px-3 py-2 bg-on-surface/[0.015]">
                                <div className="flex items-center gap-2">
                                  <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-on-surface/5 text-primary">
                                    <ListTree className="h-3.5 w-3.5" />
                                  </span>
                                  <span className="text-[11px] font-black tracking-widest text-ui-muted flex items-center gap-1.5">
                                    <span>已加入来源</span>
                                    <span className="text-[10px] font-medium text-ui-muted opacity-50 tracking-normal font-sans">（文件夹已优先置顶显示）</span>
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[10.5px] font-bold text-ui-muted/55">
                                    文件夹 {sourceStats.directoryCount} · 文件 {sourceStats.fileCount}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={handleClearSourcesWithConfirm}
                                    disabled={loading || sources.length === 0}
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded-[6px] border px-2.5 py-1 text-[10.5px] font-bold transition-all disabled:opacity-40",
                                      showClearConfirm
                                        ? "border-error/30 bg-error/10 text-error animate-pulse"
                                        : "border-on-surface/8 bg-surface text-on-surface/55 hover:border-error/20 hover:bg-error/5 hover:text-error"
                                    )}
                                    title={showClearConfirm ? "再次点击以确认清空" : "一键清空当前来源列表"}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    {showClearConfirm ? "确认清空？" : "清空来源"}
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
                                      return (
                                        <div key={group.group_id} className="rounded-xl border border-primary/20 bg-primary/[0.04] p-3 text-on-surface/80">
                                          <div
                                            onClick={() => toggleImportGroupExpanded(group.group_id)}
                                            className="flex items-start justify-between gap-3 cursor-pointer hover:bg-primary/[0.03] -m-2 p-2 rounded-lg transition-colors select-none"
                                          >
                                            <div className="min-w-0 flex items-start gap-2">
                                              <div className="mt-1 shrink-0 flex items-center justify-center">
                                                <ChevronDown className={cn("h-4 w-4 text-primary/70 transition-transform duration-200", !group.expanded && "-rotate-90")} />
                                              </div>
                                              <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                  <Layers3 className="h-4 w-4 text-primary/70 shrink-0" />
                                                  <p className="text-[13px] font-black tracking-tight text-on-surface">
                                                    已从 {group.source_path.split(/[\\/]/).pop()} 导入 {group.items.length} 项
                                                  </p>
                                                </div>
                                                <p className="mt-1 truncate font-mono text-[10px] font-bold text-ui-muted opacity-40 uppercase tracking-widest">
                                                  批量导入 · {group.source_path}
                                                </p>
                                              </div>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-1.5">
                                              <button
                                                type="button"
                                                disabled={loading}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  removeImportGroup(group.group_id);
                                                }}
                                                className="rounded-[6px] px-2.5 py-1.5 text-[10.5px] font-bold text-ui-muted/55 transition-colors hover:bg-error/10 hover:text-error"
                                              >
                                                移除整组
                                              </button>
                                            </div>
                                          </div>
                                          {group.expanded && (
                                            <div className="mt-3 grid gap-2 border-t border-primary/10 pt-3">
                                              {group.items.map((groupItem) => renderSourceRow(groupItem, { nested: true }))}
                                            </div>
                                          )}
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
                              description: "根据文件名和内容，分配到您指定的文件夹中。",
                            },
                            {
                              method: "categorize_into_new_structure" as const,
                              title: "生成新分类结构",
                              description: "让 AI 根据文件自动生成新的多级文件夹并分类存放。",
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
                                  "group rounded-xl border-2 px-4 py-4 text-left transition-all duration-300 active:scale-[0.98] disabled:opacity-50 hover:-translate-y-0.5",
                                  active
                                    ? "border-primary/40 bg-primary/[0.03] ring-1 ring-primary/10 shadow-[0_0_12px_rgba(59,130,246,0.06)]"
                                    : "border-on-surface/8 bg-surface-container-lowest hover:border-primary/20 hover:bg-surface hover:shadow-sm",
                                )}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <p className={cn("text-[14px] font-bold tracking-tight", active ? "text-primary" : "text-on-surface/80")}>
                                    {option.title}
                                  </p>
                                  <div className={cn(
                                    "flex items-center gap-1.5 rounded-[6px] border px-2 py-0.5 text-[11px] font-medium transition-all duration-300 shrink-0",
                                    active
                                      ? "border-primary/20 bg-primary/10 text-primary"
                                      : "border-on-surface/5 bg-on-surface/[0.02] text-on-surface-variant/40 group-hover:border-on-surface/10 group-hover:text-on-surface-variant/60"
                                  )}>
                                    {option.method === "assign_into_existing_categories" ? (
                                      <>
                                        <FileText className="h-3 w-3 shrink-0" />
                                        <span className="text-[9px] font-bold opacity-40">→</span>
                                        <FolderOpen className={cn("h-3 w-3 shrink-0", active ? "text-primary" : "text-on-surface-variant/50")} />
                                      </>
                                    ) : (
                                      <>
                                        <FolderOpen className="h-3 w-3 shrink-0" />
                                        <span className="text-[9px] font-bold opacity-40">→</span>
                                        <ListTree className={cn("h-3 w-3 shrink-0", active ? "text-primary" : "text-on-surface-variant/50")} />
                                      </>
                                    )}
                                  </div>
                                </div>
                                <p className="mt-2 text-[12px] font-medium leading-relaxed text-ui-muted opacity-60">{option.description}</p>
                              </button>
                            );
                          })}
                        </div>
                        {renderMethodExplanation()}
                      </div>
                    ) : null}

                    {step === 3 ? (
                      <div className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 border-b border-on-surface/10 pb-3">
                            <div className="flex h-6 w-6 items-center justify-center rounded-[4px] bg-primary/10 text-primary">
                              <FolderOpen className="h-3.5 w-3.5" />
                            </div>
                            <h2 className="text-[14px] font-bold text-on-surface">默认放置规则</h2>
                          </div>

                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="rounded-[8px] border border-on-surface/8 bg-surface-container-lowest p-3.5 transition-all focus-within:border-primary/30">
                              <div className="mb-2 text-[12px] font-bold text-on-surface">
                                {isAssignExisting ? "未匹配条目默认根路径" : "新目录生成位置"}
                              </div>
                              <div className="flex gap-2">
                                <input
                                  value={newDirectoryRoot}
                                  onChange={(event) => setNewDirectoryRoot(event.target.value)}
                                  disabled={loading}
                                  placeholder={placementConfig.defaultNewDirectoryRoot || (isFullCategorize ? "新目录生成路径" : "当前任务工作区")}
                                  className="h-9 flex-1 rounded-[6px] border border-transparent bg-on-surface/[0.03] px-2.5 text-[12.5px] font-medium text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary/30 focus:bg-surface focus:ring-2 focus:ring-primary/5"
                                />
                                <button
                                  type="button"
                                  onClick={() => void handleSelectPlacementRoot("new")}
                                  disabled={loading}
                                  className="h-9 rounded-[6px] border border-on-surface/8 bg-surface px-3 text-[11.5px] font-bold text-on-surface transition-colors hover:border-primary/20 hover:text-primary disabled:opacity-50"
                                >
                                  选择目录
                                </button>
                              </div>
                              <p className="mt-2 text-[10.5px] font-medium leading-relaxed text-ui-muted opacity-80">
                                {isAssignExisting
                                  ? "用于存放未匹配的条目。留空时使用系统默认放置规则。"
                                  : "留空时使用系统默认放置规则（任务启动根目录）。"}
                              </p>
                            </div>

                            <div className="rounded-[8px] border border-on-surface/8 bg-surface-container-lowest p-3.5 transition-all focus-within:border-primary/30">
                              <div className="mb-2 flex items-center justify-between gap-3">
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
                                    "rounded-full border px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] transition-colors",
                                    reviewFollowsNewRoot
                                      ? "border-primary/20 bg-primary/10 text-primary"
                                      : "border-on-surface/8 bg-surface text-ui-muted",
                                  ].join(" ")}
                                >
                                  {reviewFollowsNewRoot ? "跟随新目录" : "独立设置"}
                                </button>
                              </div>
                              <div className="flex gap-2">
                                <input
                                  value={reviewFollowsNewRoot ? "" : reviewRoot}
                                  onChange={(event) => {
                                    setReviewRoot(event.target.value);
                                    setReviewFollowsNewRoot(false);
                                  }}
                                  disabled={loading || reviewFollowsNewRoot}
                                  placeholder={reviewFollowsNewRoot ? derivedReviewRoot || "跟随新目录路径自动生成" : placementConfig.globalReviewRoot || derivedReviewRoot || "独立指定待确认区路径"}
                                  className="h-9 flex-1 rounded-[6px] border border-transparent bg-on-surface/[0.03] px-2.5 text-[12.5px] font-medium text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary/30 focus:bg-surface focus:ring-2 focus:ring-primary/5 disabled:opacity-60"
                                />
                                <button
                                  type="button"
                                  onClick={() => void handleSelectPlacementRoot("review")}
                                  disabled={loading || reviewFollowsNewRoot}
                                  className="h-9 rounded-[6px] border border-on-surface/8 bg-surface px-3 text-[11.5px] font-bold text-on-surface transition-colors hover:border-primary/20 hover:text-primary disabled:opacity-50"
                                >
                                  选择目录
                                </button>
                              </div>
                              <p className="mt-2 text-[10.5px] font-medium leading-relaxed text-ui-muted opacity-80">
                                默认跟随新目录根路径生成 Review 子目录，不再创建更深层级的目录结构。
                              </p>
                            </div>
                          </div>
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
                              draggingClassName: "border-success/30 bg-success/[0.015]",
                              activeClassName: "border-success/45 bg-success/8 text-success ring-1 ring-success/15",
                              className: "relative overflow-hidden rounded-[8px] p-4 transition-all duration-300",
                            })}
                          >
                            {isTargetDropActive && (
                              <DropZoneOverlay
                                icon={FolderPlus}
                                title="松手即可添加为目标候选"
                                detail="这里只接受文件夹，文件会被自动忽略"
                                className="inset-0 rounded-[8px]"
                                tone="success"
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

                        <div className="grid gap-4 md:grid-cols-2">
                          {isFullCategorize ? (
                            <>
                              {/* 分类控制参数 */}
                              <div className="rounded-[8px] bg-surface-container-lowest p-4 flex flex-col justify-between min-h-[160px] border border-on-surface/5">
                                <div className="space-y-3.5">
                                  <div className="flex items-center justify-between">
                                    <h2 className="text-[13px] font-bold text-on-surface flex items-center gap-1.5">
                                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                                      分类控制参数
                                    </h2>
                                  </div>

                                  <div className="grid grid-cols-2 gap-3">
                                    {/* 分类模板 */}
                                    <div className="space-y-1">
                                      <div className="text-[11px] font-bold text-on-surface/60">分类模板</div>
                                      <select
                                        value={strategy.template_id}
                                        onChange={(event) => {
                                          const tid = event.target.value as any;
                                          updateStrategy((previous) => ({
                                            ...previous,
                                            template_id: tid,
                                            ...getSuggestedSelection(tid),
                                          }));
                                        }}
                                        disabled={loading}
                                        className="h-8.5 w-full rounded-[6px] border border-on-surface/8 bg-surface px-2 text-[12px] font-medium text-on-surface outline-none transition-all focus:border-primary/45 focus:ring-2 focus:ring-primary/5"
                                      >
                                        {STRATEGY_TEMPLATES.map((template) => (
                                          <option key={template.id} value={template.id}>
                                            {template.label}
                                          </option>
                                        ))}
                                      </select>
                                    </div>

                                    {/* 目录语言 */}
                                    <div className="space-y-1">
                                      <div className="text-[11px] font-bold text-on-surface/60">目录语言</div>
                                      <div className="flex h-8.5 rounded-[6px] border border-on-surface/8 bg-surface p-0.5 items-center">
                                        {LANGUAGE_OPTIONS.map((option) => {
                                          const active = strategy.language === option.id;
                                          return (
                                            <button
                                              key={option.id}
                                              type="button"
                                              onClick={() => updateStrategy((prev) => ({ ...prev, language: option.id }))}
                                              className={cn(
                                                "flex-1 rounded-[4px] h-full text-[12px] transition-all",
                                                active
                                                  ? "bg-primary/10 text-primary font-semibold"
                                                  : "text-on-surface/60 font-medium hover:text-on-surface"
                                              )}
                                            >
                                              {option.label.replace("目录", "")}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </div>

                                  {/* 前缀样式 */}
                                  <div className="space-y-1">
                                    <div className="text-[11px] font-bold text-on-surface/60">前缀样式</div>
                                    <select
                                      value={strategy.prefix_style}
                                      onChange={(event) => updateStrategy((prev) => ({ ...prev, prefix_style: event.target.value as any }))}
                                      className="h-8.5 w-full rounded-[6px] border border-on-surface/8 bg-surface px-2.5 text-[12px] font-medium text-on-surface outline-none transition-all focus:border-primary/45 focus:ring-2 focus:ring-primary/5"
                                    >
                                      {PREFIX_STYLE_OPTIONS.map((option) => (
                                        <option key={option.id} value={option.id}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </div>

                                <div className="mt-3.5 flex justify-between items-center border-t border-on-surface/5 pt-2">
                                  <span className="text-[11px] text-on-surface/40 font-medium">微调更多细节？</span>
                                  <button
                                    type="button"
                                    onClick={() => setAdvancedSettingsDialogOpen(true)}
                                    className="text-[11px] font-bold text-primary hover:underline underline-offset-2"
                                  >
                                    更多高级参数...
                                  </button>
                                </div>
                              </div>

                              {/* 分类样式示例 */}
                              <div className="rounded-[8px] bg-surface-container-lowest p-4 flex flex-col justify-between min-h-[220px] border border-on-surface/5">
                                <div className="space-y-3">
                                  <div className="text-[13px] font-black text-on-surface">分类样式示例</div>

                                  {/* 极简模拟树状图面板 */}
                                  <div className="rounded-[6px] border border-on-surface/8 bg-surface p-3 font-mono text-[11px] text-on-surface/80 max-h-[140px] overflow-y-auto scrollbar-thin space-y-2">
                                    {/* 根目录节点 */}
                                    <div className="flex items-center gap-1.5 text-on-surface-variant/70 font-semibold truncate border-b border-on-surface/5 pb-2">
                                      <FolderOpen className="h-3.5 w-3.5 text-primary/60 shrink-0" />
                                      <span className="truncate" title={newDirectoryRoot || "D:/Desktop/毕业/毕业答辩PPT"}>
                                        {newDirectoryRoot || "D:/Desktop/毕业/毕业答辩PPT"}
                                      </span>
                                    </div>

                                    {/* 子树节点 */}
                                    <div className="pl-1.5 space-y-2 pt-0.5">
                                      {currentSummary.preview_directories?.map((directory, idx, arr) => {
                                        const isLastDir = idx === arr.length - 1;

                                        // 智能模拟子文件类型
                                        let mockFile = "相关文档.docx";
                                        if (directory.includes("票") || directory.includes("账") || directory.includes("财")) {
                                          mockFile = "账单发票.xlsx";
                                        } else if (directory.includes("资料") || directory.includes("学习")) {
                                          mockFile = "复习课件.pptx";
                                        } else if (directory.includes("归") || directory.includes("史") || directory.includes("备份")) {
                                          mockFile = "备份归档.zip";
                                        } else if (directory.includes("图") || directory.includes("照") || directory.includes("影")) {
                                          mockFile = "素材照片.png";
                                        }

                                        return (
                                          <div key={directory} className="space-y-1">
                                            {/* 文件夹行 */}
                                            <div className="flex items-center gap-1.5">
                                              <span className="text-on-surface/20 font-bold font-sans shrink-0">{isLastDir ? "└─" : "├─"}</span>
                                              <span className="inline-flex items-center gap-1 rounded-[4px] border border-primary/10 bg-primary/[0.04] px-2 py-0.5 text-[11px] font-bold text-primary max-w-[85%] truncate">
                                                <FolderOpen className="h-3 w-3 shrink-0 text-primary/60" />
                                                <span className="truncate">{directory}</span>
                                              </span>
                                            </div>

                                            {/* 模拟文件行 */}
                                            <div className="flex items-center gap-1.5 text-[10.5px] text-ui-muted opacity-55" style={{ paddingLeft: "24px" }}>
                                              <span className="text-on-surface/20 font-bold font-sans shrink-0">{isLastDir ? "    └─" : "│   └─"}</span>
                                              <FileText className="h-3 w-3 shrink-0" />
                                              <span className="truncate">{mockFile}</span>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                                <p className="mt-2 text-[10.5px] font-medium leading-relaxed text-ui-muted truncate" title={currentTemplate.description}>
                                  {currentTemplate.description}
                                </p>
                              </div>
                            </>
                          ) : (
                            <>
                              {/* 归归档倾向配置 */}
                              <div className="rounded-[8px] bg-surface-container-lowest p-4 flex flex-col justify-between min-h-[160px] border border-on-surface/5">
                                <div className="space-y-3.5">
                                  <h2 className="text-[13px] font-black text-on-surface flex items-center gap-1.5">
                                    <Activity className="h-3.5 w-3.5 text-primary" />
                                    归档倾向配置
                                  </h2>

                                  <div className="space-y-1.5">
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-ui-muted">分类归档策略</div>
                                    <div className="grid grid-cols-2 gap-2">
                                      {CAUTION_LEVEL_OPTIONS.map((option) => {
                                        const active = strategy.caution_level === option.id;
                                        return (
                                          <button
                                            key={option.id}
                                            type="button"
                                            onClick={() => updateStrategy((prev) => ({ ...prev, caution_level: option.id }))}
                                            className={cn(
                                              "rounded-[6px] border px-2.5 py-1.5 text-left transition-all text-[11px] font-bold",
                                              active
                                                ? "border-primary/25 bg-primary/10 text-primary"
                                                : "border-on-surface/8 bg-surface text-on-surface hover:bg-surface-container-low"
                                            )}
                                          >
                                            <div>{option.label}</div>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* 任务补充说明 */}
                              <div className="rounded-[8px] bg-surface-container-lowest p-4 flex flex-col justify-between min-h-[160px] border border-on-surface/5">
                                <div className="space-y-2 flex-1 flex flex-col">
                                  <div className="text-[11px] font-black text-on-surface flex items-center gap-1.5">
                                    <FileText className="h-3.5 w-3.5 text-primary" />
                                    补充说明 (可选)
                                  </div>
                                  <textarea
                                    value={strategy.note}
                                    disabled={loading}
                                    onChange={(event) => updateStrategy((previous) => ({ ...previous, note: event.target.value.slice(0, 200) }))}
                                    placeholder="例如：拿不准的先放待确认区；优先归入现有项目目录。"
                                    className="w-full flex-1 min-h-[80px] resize-none rounded-[6px] border border-on-surface/8 bg-surface px-3 py-2 text-[12px] leading-relaxed text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary/30"
                                  />
                                </div>
                              </div>
                            </>
                          )}
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
        <DialogContent className="max-w-[440px] p-5">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-[15px] font-black text-on-surface">高级设置</DialogTitle>
            <DialogDescription className="text-[11.5px] text-ui-muted/80">
              在此微调分类粒度、归档策略及附加规则说明。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {!isAssignExisting ? (
              <div className="space-y-1.5 rounded-[8px] border border-on-surface/6 bg-surface-container-lowest p-3.5">
                <div className="text-[11.5px] font-bold text-on-surface flex items-center gap-1.5 mb-1.5">
                  <ListTree className="h-3.5 w-3.5 text-primary" />
                  分类粒度
                </div>
                <div className="flex rounded-[6px] border border-on-surface/8 bg-surface p-0.5 max-w-[200px]">
                  {DENSITY_OPTIONS.map((option) => {
                    const active = strategy.density === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => updateStrategy((prev) => ({ ...prev, density: option.id }))}
                        className={cn(
                          "flex-1 rounded-[4px] py-1 text-[11px] font-bold transition-all",
                          active
                            ? "bg-primary/10 text-primary"
                            : "text-on-surface-variant/60 hover:text-on-surface"
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1.5 text-[10.5px] leading-relaxed text-ui-muted opacity-80">
                  {strategy.density === "minimal"
                    ? "生成极简的核心目录结构，避免过度细分目录。"
                    : "按标准格式与逻辑生成细分的多层级目录。"}
                </p>
              </div>
            ) : null}

            {/* 归档倾向 */}
            <div className="space-y-1.5 rounded-[8px] border border-on-surface/6 bg-surface-container-lowest p-3.5">
              <div className="text-[11.5px] font-bold text-on-surface flex items-center gap-1.5 mb-2">
                <Activity className="h-3.5 w-3.5 text-primary" />
                分类归档策略
              </div>
              <div className="grid grid-cols-2 gap-2">
                {CAUTION_LEVEL_OPTIONS.map((option) => {
                  const active = strategy.caution_level === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => updateStrategy((prev) => ({ ...prev, caution_level: option.id }))}
                      className={cn(
                        "rounded-[6px] border px-2.5 py-1.5 text-left transition-all text-[11px] font-bold flex flex-col justify-between min-h-[52px]",
                        active
                          ? "border-primary/25 bg-primary/10 text-primary"
                          : "border-on-surface/8 bg-surface text-on-surface hover:bg-surface-container-low"
                      )}
                    >
                      <div>{option.label}</div>
                      <div className={cn(
                        "mt-0.5 text-[9.5px] font-medium leading-tight",
                        active ? "text-primary/70" : "text-ui-muted/70"
                      )}>
                        {option.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 补充说明 */}
            <div className="space-y-1.5 rounded-[8px] border border-on-surface/6 bg-surface-container-lowest p-3.5">
              <div className="text-[11.5px] font-bold text-on-surface flex items-center gap-1.5 mb-1">
                <FileText className="h-3.5 w-3.5 text-primary" />
                附加说明
              </div>
              <textarea
                value={strategy.note}
                disabled={loading}
                onChange={(event) => updateStrategy((previous) => ({ ...previous, note: event.target.value.slice(0, 200) }))}
                placeholder={isAssignExisting ? "例如：拿不准的先放待确认区；优先归入现有项目目录。" : "例如：课程资料按学期整理；图片素材按用途分层。"}
                className="h-[72px] w-full resize-none rounded-[6px] border border-on-surface/8 bg-surface px-2.5 py-1.5 text-[11.5px] leading-relaxed text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary/30"
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
