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
  FolderPlus,
  ChevronLeft,
  X,
  Info,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

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
import { subscribeAppContext } from "@/lib/app-context-store";
import { isHistorySessionEntry } from "@/lib/use-history-list";
import { deriveWorkspaceRoot } from "@/lib/path-normalization";
import { buildWorkspaceRoute, getWorkspaceRouteForSnapshot } from "@/lib/workspace-routes";
import {
  clearLauncherDraft,
  persistLauncherDraft,
  readLauncherDraft,
  sanitizeLauncherDraft,
  type LauncherDraftState,
} from "@/lib/launcher-draft";
import {
  createDirectorySource,
  createImportGroupId,
  dedupeSources,
  dedupeTargetDirectories,
  extractDroppedSources,
  inferSourceSelectionsFromPaths,
  mapDirectoryEntryToSource,
  pathKey,
  sortSourcesForDisplay,
  sourceSelectionFromDraft,
  sourceSelectionKey,
  targetDirectoryEditorKey,
  type SourceDraftType,
  type SourceImportGroup,
  type TargetDirectoryDraft,
} from "@/lib/launcher-sources";
import {
  describeWorkspaceTask,
  getHistoryRoute,
  readActiveWorkspaceTask,
  rememberWorkspaceRoute,
  type LaunchWorkbenchTask,
} from "@/lib/launcher-task-helpers";
import {
  buildStrategySummary,
  CAUTION_LEVEL_OPTIONS,
  DEFAULT_STRATEGY_SELECTION,
  DENSITY_OPTIONS,
  getLaunchStrategyFromConfig,
  getTemplateMeta,
  shouldSkipLaunchStrategyPrompt,
} from "@/lib/strategy-templates";
import { cn } from "@/lib/utils";
import type {
  DirectorySourceMode,
  LaunchStrategyConfig,
  OrganizeMethod,
  SessionSnapshot,
  SessionSourceSelection,
  SessionStrategySelection,
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
import { LauncherHistoryPanel } from "./launcher/launcher-history-panel";
import { ResumePromptDialog } from "./launcher/resume-prompt-dialog";
import { type LauncherSourceListItem } from "./launcher/source-list";
import { SourceStep } from "./launcher/source-step";
import { OneClickPanel } from "./one-click-panel";
import { StrategyStep } from "./launcher/strategy-step";

type SourceFeedback = {
  tone: "success" | "info";
  message: string;
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
  const [backendUnavailable, setBackendUnavailable] = useState(false);
  const [backendReloadNonce, setBackendReloadNonce] = useState(0);
  const sourceDropZoneRef = useRef<HTMLDivElement | null>(null);
  const targetDropZoneRef = useRef<HTMLDivElement | null>(null);
  // 启动请求代次：超时后使在途请求作废，防止迟到的响应突然把用户拽进工作区。
  const launchAttemptRef = useRef(0);

  useEffect(() => {
    if (!launchTransitionOpen) {
      return;
    }
    if (pathname !== "/") {
      setLaunchTransitionOpen(false);
      return;
    }
    const timer = window.setTimeout(() => {
      // 作废在途启动请求：迟到的成功响应只会更新"当前任务"入口，不再触发跳转。
      launchAttemptRef.current += 1;
      setLaunchTransitionOpen(false);
      setLoading(false);
      setError("打开工作区等待时间过长。任务可能已经创建成功，稍等片刻后左侧“当前任务”出现即可继续进入；如果没有出现，请重试。");
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

  // 把“普通来源行 + 导入组头 + 展开的组内行”拍平成单一数组，交给虚拟滚动统一渲染。
  const sourceListItems = useMemo<LauncherSourceListItem[]>(() => {
    const items: LauncherSourceListItem[] = [];
    const renderedGroupIds = new Set<string>();
    for (const item of displaySources) {
      const key = sourceSelectionKey(item);
      const group = sourceImportGroupByKey.get(key);
      if (!group) {
        items.push({ kind: "source", key, source: item });
        continue;
      }
      if (renderedGroupIds.has(group.group_id)) {
        continue;
      }
      const firstVisibleKey = group.item_keys.find((candidate) => sourceKeyMap.has(candidate));
      if (firstVisibleKey !== key) {
        continue;
      }
      renderedGroupIds.add(group.group_id);
      items.push({ kind: "group-header", key: group.group_id, group });
      if (group.expanded) {
        group.items.forEach((groupItem, index) => {
          items.push({
            kind: "group-source",
            key: `${group.group_id}:${sourceSelectionKey(groupItem)}`,
            source: groupItem,
            isFirst: index === 0,
            isLast: index === group.items.length - 1,
          });
        });
      }
    }
    return items;
  }, [displaySources, sourceImportGroupByKey, sourceKeyMap]);

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
    // 防抖：sources 可能包含数千条导入项，序列化 + 同步写盘不能跟着每次按键跑。
    const timer = window.setTimeout(() => {
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
      persistLauncherDraft(draft);
    }, 400);
    return () => window.clearTimeout(timer);
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
        setBackendUnavailable(false);
      } catch {
        if (!cancelled) {
          if (!launcherDraft?.strategy) {
            setStrategy(DEFAULT_STRATEGY_SELECTION);
          }
          setLaunchConfig(null);
          if (launcherDraft?.reviewFollowsNewRoot === undefined) {
            setReviewFollowsNewRoot(true);
          }
          // 连不上后端时无法判断模型状态，标记连接异常而不是伪装成"可用"。
          setTextModelConfigured(true);
          setBackendUnavailable(true);
        }
      }
    }

    void loadLaunchPreferences();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, backendReloadNonce, draftHydrated, launcherDraft?.reviewFollowsNewRoot, launcherDraft?.strategy]);

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
    return subscribeAppContext(syncActiveWorkspace);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadCommonDirs() {
      try {
        const api = createApiClient(apiBaseUrl, getApiToken());
        const dirs = await api.getCommonDirs();
        if (!cancelled) setCommonDirs(dirs);
      } catch {
        if (!cancelled) {
          setCommonDirs([]);
          setBackendUnavailable(true);
        }
      }
    }
    void loadCommonDirs();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, backendReloadNonce]);

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
          setBackendUnavailable(true);
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
  }, [apiBaseUrl, backendReloadNonce]);

  useEffect(() => {
    let cancelled = false;
    async function loadTargetProfiles() {
      setTargetProfilesLoading(true);
      try {
        const api = createApiClient(apiBaseUrl, getApiToken());
        const items = await api.getTargetProfiles();
        if (!cancelled) setTargetProfiles(items);
      } catch {
        if (!cancelled) {
          setTargetProfiles([]);
          setBackendUnavailable(true);
        }
      } finally {
        if (!cancelled) setTargetProfilesLoading(false);
      }
    }
    void loadTargetProfiles();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl, backendReloadNonce]);

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

  const removeSource = useCallback((path: string, sourceType: SessionSourceSelection["source_type"]) => {
    setSources((previous) => {
      const nextSources = previous.filter((item) => !(item.path === path && item.source_type === sourceType));
      setSourceImportGroups((previousGroups) => pruneImportGroups(previousGroups, nextSources));
      return nextSources;
    });
  }, [pruneImportGroups]);

  const updateDirectorySourceMode = useCallback((path: string, directoryMode: DirectorySourceMode) => {
    setSources((previous) =>
      dedupeSources(
        previous.map((item) =>
          item.source_type === "directory" && item.path === path
            ? createDirectorySource(item.path, directoryMode)
            : item,
        ),
      ),
    );
  }, []);

  const setSourceAtomicMode = useCallback((path: string) => {
    updateDirectorySourceMode(path, "atomic");
  }, [updateDirectorySourceMode]);

  const toggleImportGroupExpanded = useCallback((groupId: string) => {
    setSourceImportGroups((previous) =>
      previous.map((group) =>
        group.group_id === groupId ? { ...group, expanded: !group.expanded } : group,
      ),
    );
  }, []);

  const removeImportGroup = useCallback((groupId: string) => {
    setSourceImportGroups((previousGroups) => {
      const group = previousGroups.find((item) => item.group_id === groupId);
      if (!group) {
        return previousGroups;
      }
      const keysToRemove = new Set(group.item_keys);
      setSources((previous) => previous.filter((item) => !keysToRemove.has(sourceSelectionKey(item))));
      return previousGroups.filter((item) => item.group_id !== groupId);
    });
  }, []);

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

  // 行内“导入内部项”按钮的稳定回调：通过 ref 转发到最新的 handleImportFromSource，
  // 避免因闭包变化导致 memo 化的 SourceRow 在无关状态更新（如手填路径键入）时整列重渲染。
  const importFromSourceRef = useRef<(item: SessionSourceSelection) => void>(() => {});
  useEffect(() => {
    importFromSourceRef.current = (item) => {
      void handleImportFromSource(item);
    };
  });
  const handleImportInternal = useCallback((item: SessionSourceSelection) => {
    importFromSourceRef.current(item);
  }, []);

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
    const attemptId = ++launchAttemptRef.current;
    setLoading(true);
    setLaunchTransitionOpen(true);
    setError(null);

    try {
      const api = createApiClient(apiBaseUrl, getApiToken());
      const response = await createLaunchSession(api, launchRequest);
      const isStaleAttempt = attemptId !== launchAttemptRef.current;
      if (response.mode === "resume_available" && response.restorable_session?.session_id) {
        if (isStaleAttempt) {
          return;
        }
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
      const workspaceRoute = buildWorkspaceRoute("progress", {
        sessionId: response.session_id,
        dir: launchRequest.display_path || firstSourcePath(launchRequest.sources),
        autoScan: true,
      });
      if (isStaleAttempt) {
        // 超时提示已出现：只把会话登记进"当前任务"入口，不再突然跳转打断用户。
        rememberWorkspaceRoute(workspaceRoute);
        return;
      }
      clearLauncherDraft();
      rememberWorkspaceRoute(workspaceRoute);
      router.push(workspaceRoute);
    } catch (err: any) {
      if (attemptId !== launchAttemptRef.current) {
        return;
      }
      setLaunchTransitionOpen(false);
      if (err.message && err.message.toLowerCase().includes("failed to fetch")) {
        setError(`现在连不上本地服务，请确认它是否已经启动（${apiBaseUrl}）。`);
      } else {
        setError(err instanceof Error ? err.message : "创建会话或启动扫描失败，请再试一次。");
      }
    } finally {
      if (attemptId === launchAttemptRef.current) {
        setLoading(false);
      }
    }
  }

  async function handleStartFresh() {
    if (!resumePrompt) return;
    const attemptId = ++launchAttemptRef.current;
    setLoading(true);
    setLaunchTransitionOpen(true);
    setError(null);

    try {
      const api = createApiClient(apiBaseUrl, getApiToken());
      const response = await startFreshSession(api, resumePrompt.sessionId, resumePrompt.snapshot.stage, resumePrompt.launch);
      if (!response.session_id) throw new Error("没有成功重新开始，请再试一次。");
      const workspaceRoute = buildWorkspaceRoute("progress", {
        sessionId: response.session_id,
        dir: resumePrompt.launch.display_path || firstSourcePath(resumePrompt.launch.sources),
        autoScan: true,
      });
      if (attemptId !== launchAttemptRef.current) {
        rememberWorkspaceRoute(workspaceRoute);
        return;
      }
      setResumePrompt(null);
      clearLauncherDraft();
      rememberWorkspaceRoute(workspaceRoute);
      router.push(workspaceRoute);
    } catch (err: any) {
      if (attemptId !== launchAttemptRef.current) {
        return;
      }
      setLaunchTransitionOpen(false);
      if (err.message && err.message.toLowerCase().includes("failed to fetch")) {
        setError(`现在连不上本地服务，请确认它是否已经启动（${apiBaseUrl}）。`);
      } else {
        setError(err instanceof Error ? err.message : "重新开始并启动扫描失败，请再试一次。");
      }
    } finally {
      if (attemptId === launchAttemptRef.current) {
        setLoading(false);
      }
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
          <h2 className="text-[16px] font-black tracking-tight text-on-surface">
            继续手头任务，或开始一次新的整理
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => router.push("/settings?tab=text")}
            className="h-8 rounded-[8px] px-3 text-[11px] font-black uppercase tracking-wider"
          >
            模型设置
          </Button>
        </div>
      </div>

      <div className="grid gap-4 pt-4">
        <div className="space-y-3">
          {backendUnavailable ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-error/20 bg-error/[0.03] px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-error/10 text-error">
                  <AlertCircle className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-black text-on-surface">无法连接本地服务</p>
                  <p className="mt-0.5 text-[12px] font-medium text-ui-muted/70">
                    最近记录、快捷目录等数据暂时读取不到。请确认应用已正常启动（{apiBaseUrl}），然后重试。
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBackendReloadNonce((nonce) => nonce + 1)}
                className="shrink-0 rounded-[8px] border border-error/20 bg-surface px-3 py-1.5 text-[11px] font-bold text-error transition-colors hover:bg-error/5"
              >
                重新连接
              </button>
            </div>
          ) : null}
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
                <p className="mt-0.5 block max-w-full truncate text-[12px] font-medium text-ui-muted/60" title={activeWorkspaceTask.route}>
                  {describeWorkspaceTask(activeWorkspaceTask)}
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
                <p className="mt-0.5 text-[12px] font-medium text-ui-muted/50">主工作台处于闲置状态，添加整理来源即可唤起新任务。</p>
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
              <p className="mt-1 text-[12px] font-medium leading-relaxed text-ui-muted/60">拖入或混选本地文件与文件夹，由 AI 自动推导分类目录结构。</p>
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
              <p className="mt-1 text-[12px] font-medium leading-relaxed text-ui-muted/60">检索以往的历史整理方案与操作归档，并可在此一键安全回退。</p>
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
              <p className="mt-1 text-[12px] font-medium leading-relaxed text-ui-muted/60">为新建的文件夹匹配并应用图标，提升视觉辨识度。</p>
            </button>
          </div>
        </div>

        <LauncherHistoryPanel
          entries={recentHistory}
          loading={historyLoading}
          backendUnavailable={backendUnavailable}
          onOpenHistoryPage={() => router.push("/history")}
          onOpenEntry={(entry) =>
            router.push(isHistorySessionEntry(entry) ? getHistoryRoute(entry) : `/history?entry_id=${entry.execution_id}`)
          }
        />
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
              className="mx-auto flex w-full max-w-[1080px] flex-col gap-3 py-6"
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
                      <p className="text-[13px] font-black leading-tight text-on-surface">
                        {sourceFeedback.tone === "success" ? "来源已更新" : "导入提示"}
                      </p>
                      <p className="mt-1.5 text-[12px] font-medium leading-relaxed text-ui-muted opacity-80">{sourceFeedback.message}</p>
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

               {!launchFlowOpen ? (
                 <div className="mb-4">
                   <OneClickPanel />
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
                              "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-black transition-all",
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
                      <SourceStep
                        sourceDropZoneRef={sourceDropZoneRef}
                        loading={loading}
                        isDropActive={isDropActive}
                        isDraggingGlobal={isDraggingGlobal}
                        isDesktopEnvironment={isDesktopEnvironment}
                        isSourceDropdownOpen={isSourceDropdownOpen}
                        onSetSourceDropdownOpen={setIsSourceDropdownOpen}
                        showManualInput={showManualInput}
                        onSetShowManualInput={setShowManualInput}
                        commonDirs={commonDirs}
                        sourceDraftType={sourceDraftType}
                        onSetSourceDraftType={setSourceDraftType}
                        sourceDraftPath={sourceDraftPath}
                        onSetSourceDraftPath={setSourceDraftPath}
                        onAddManualSource={addManualSource}
                        onImportDirectoryEntries={() => void handleImportDirectoryEntries()}
                        onChooseDirectories={() => void handleChooseDirectories()}
                        onChooseFiles={() => void handleChooseFiles()}
                        onImportCommonDir={(path) => void importDirectoryEntries(path)}
                        listItems={sourceListItems}
                        sourceStats={sourceStats}
                        showClearConfirm={showClearConfirm}
                        onClearSources={handleClearSourcesWithConfirm}
                        onRemoveSource={removeSource}
                        onImportInternal={handleImportInternal}
                        onSetAtomicMode={setSourceAtomicMode}
                        onToggleGroupExpanded={toggleImportGroupExpanded}
                        onRemoveGroup={removeImportGroup}
                      />
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
                                        <span className="text-[11px] font-bold opacity-40">→</span>
                                        <FolderOpen className={cn("h-3 w-3 shrink-0", active ? "text-primary" : "text-on-surface-variant/50")} />
                                      </>
                                    ) : (
                                      <>
                                        <FolderOpen className="h-3 w-3 shrink-0" />
                                        <span className="text-[11px] font-bold opacity-40">→</span>
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
                                  className="h-9 flex-1 rounded-[6px] border border-transparent bg-on-surface/[0.03] px-2.5 text-[13px] font-medium text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary/30 focus:bg-surface focus:ring-2 focus:ring-primary/5"
                                />
                                <button
                                  type="button"
                                  onClick={() => void handleSelectPlacementRoot("new")}
                                  disabled={loading}
                                  className="h-9 rounded-[6px] border border-on-surface/8 bg-surface px-3 text-[12px] font-bold text-on-surface transition-colors hover:border-primary/20 hover:text-primary disabled:opacity-50"
                                >
                                  选择目录
                                </button>
                              </div>
                              <p className="mt-2 text-[11px] font-medium leading-relaxed text-ui-muted opacity-80">
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
                                    "rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.1em] transition-colors",
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
                                  className="h-9 flex-1 rounded-[6px] border border-transparent bg-on-surface/[0.03] px-2.5 text-[13px] font-medium text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary/30 focus:bg-surface focus:ring-2 focus:ring-primary/5 disabled:opacity-60"
                                />
                                <button
                                  type="button"
                                  onClick={() => void handleSelectPlacementRoot("review")}
                                  disabled={loading || reviewFollowsNewRoot}
                                  className="h-9 rounded-[6px] border border-on-surface/8 bg-surface px-3 text-[12px] font-bold text-on-surface transition-colors hover:border-primary/20 hover:text-primary disabled:opacity-50"
                                >
                                  选择目录
                                </button>
                              </div>
                              <p className="mt-2 text-[11px] font-medium leading-relaxed text-ui-muted opacity-80">
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

                            {isAssignExisting && effectiveTargetDirectories.length === 0 && !selectedTargetProfileId.trim() && (
                              <div className="mb-4 rounded-[8px] border border-primary/15 bg-primary/[0.02] p-3 text-[12px] font-medium leading-relaxed text-on-surface-variant flex items-start gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                                <Info className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                                <div>
                                  <span className="font-bold text-on-surface">需要目标目录：</span>
                                  当前选择的整理方式需要至少一个目标目录。请选择一个已有目录配置，或在下方添加/拖入目标文件夹。
                                </div>
                              </div>
                            )}

                            <div className="mb-4">
                              <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.15em] text-ui-muted">已有目录配置</div>
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
                              <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-ui-muted">补充目标目录</div>

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
                                                {isFromProfile && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-black uppercase text-primary tracking-widest leading-none">已保存</span>}
                                              </div>
                                              <div className="truncate font-mono text-[11px] font-medium text-ui-muted opacity-40 uppercase tracking-tighter" title={item.path}>{item.path}</div>
                                              {item.label ? (
                                                <div className="mt-1 inline-flex rounded-[6px] bg-primary/[0.06] px-2 py-0.5 text-[11px] font-bold text-primary">
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







                                className="flex flex-col items-center justify-center rounded-[8px] border border-dashed border-on-surface/10 bg-surface-container-lowest px-4 py-6 transition-all duration-300 sm:flex-row sm:justify-between sm:py-2.5 hover:border-on-surface/20"







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

                        <StrategyStep
                          strategy={strategy}
                          loading={loading}
                          isFullCategorize={isFullCategorize}
                          newDirectoryRoot={newDirectoryRoot}
                          previewDirectories={currentSummary.preview_directories}
                          templateDescription={currentTemplate.description}
                          onUpdateStrategy={updateStrategy}
                          onOpenAdvancedSettings={() => setAdvancedSettingsDialogOpen(true)}
                        />
                      </div>
                    ) : null}

                    {/* Desktop Action Bar */}
                    <div className="pointer-events-none sticky bottom-0 z-20 mt-3 flex items-center justify-between border-t border-on-surface/10 bg-surface/90 pt-4 pb-6 backdrop-blur-md">
                      {step > 1 ? (
                        <Button
                          variant="secondary"
                          onClick={() => setStep((current) => (Math.max(1, current - 1) as 1 | 2 | 3))}
                          disabled={loading}
                          className="pointer-events-auto h-10 px-6 font-bold"
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
                          className="pointer-events-auto h-10 px-8 font-bold border border-primary/20 bg-primary"
                        >
                          {loading ? "正在启动..." : skipStrategyPrompt ? fastStartLabel : "下一步：选择整理方式"}
                        </Button>
                      ) : step === 2 ? (
                        <Button
                          variant="primary"
                          onClick={goToStepThree}
                          disabled={loading}
                          className="pointer-events-auto h-10 px-8 font-bold border border-primary/20 bg-primary"
                        >
                          下一步：填写必要信息
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          onClick={() => void launchCurrentRequest(true)}
                          disabled={loading || !textModelConfigured}
                          loading={loading}
                          className="pointer-events-auto h-10 min-w-[200px] px-8 font-bold border border-primary/20 bg-primary"
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
            <DialogDescription className="text-[12px] text-ui-muted/80">
              在此微调分类粒度、归档策略及附加规则说明。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {!isAssignExisting ? (
              <div className="space-y-1.5 rounded-[8px] border border-on-surface/6 bg-surface-container-lowest p-3.5">
                <div className="text-[12px] font-bold text-on-surface flex items-center gap-1.5 mb-1.5">
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
                <p className="mt-1.5 text-[11px] leading-relaxed text-ui-muted opacity-80">
                  {strategy.density === "minimal"
                    ? "生成极简的核心目录结构，避免过度细分目录。"
                    : "按标准格式与逻辑生成细分的多层级目录。"}
                </p>
              </div>
            ) : null}

            {/* 归档倾向 */}
            <div className="space-y-1.5 rounded-[8px] border border-on-surface/6 bg-surface-container-lowest p-3.5">
              <div className="text-[12px] font-bold text-on-surface flex items-center gap-1.5 mb-2">
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
                        "mt-0.5 text-[11px] font-medium leading-tight",
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
              <div className="text-[12px] font-bold text-on-surface flex items-center gap-1.5 mb-1">
                <FileText className="h-3.5 w-3.5 text-primary" />
                附加说明
              </div>
              <textarea
                value={strategy.note}
                disabled={loading}
                onChange={(event) => updateStrategy((previous) => ({ ...previous, note: event.target.value.slice(0, 200) }))}
                placeholder={isAssignExisting ? "例如：拿不准的先放待确认区；优先归入现有项目目录。" : "例如：课程资料按学期整理；图片素材按用途分层。"}
                className="h-[72px] w-full resize-none rounded-[6px] border border-on-surface/8 bg-surface px-2.5 py-1.5 text-[12px] leading-relaxed text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary/30"
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
