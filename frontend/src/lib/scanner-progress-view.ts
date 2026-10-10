import type { RecentAnalysisItem, ScannerProgress } from "@/types/session";

export type ScannerStepState = "active" | "done" | "pending" | "aborted";
export type WorkspaceProgressPhase = "discovering" | "analyzing" | "planning" | "stranded" | "ready";

export interface ProgressCopy {
  key: string;
  values?: Record<string, string | number>;
}

export interface ScannerDisplayStep {
  id: string;
  title: ProgressCopy;
  detail: ProgressCopy;
  state: ScannerStepState;
}

export interface ScannerProgressViewModel {
  phase: WorkspaceProgressPhase;
  eyebrow: ProgressCopy;
  title: ProgressCopy;
  description: ProgressCopy;
  backendMessage: ProgressCopy | null;
  stageLabel: ProgressCopy;
  totalCount: number;
  processedCount: number;
  progressPercent: number;
  progressText: ProgressCopy | null;
  batchLabel: ProgressCopy | null;
  batchDetail: ProgressCopy | null;
  countLabel: ProgressCopy;
  currentItem: string | null;
  currentItemHint: ProgressCopy;
  reassureText: ProgressCopy;
  isIndeterminate: boolean;
  recentCompletedItems: RecentAnalysisItem[];
  recentObservedItems: RecentAnalysisItem[];
  scanLogItems: RecentAnalysisItem[];
  steps: ScannerDisplayStep[];
}

const GENERIC_SCAN_ITEMS = new Set([
  "当前目录",
  "正在准备扫描任务",
  "正在等待模型响应",
  "正在读取目录...",
]);

// 仅用于兼容缺少结构化状态的旧扫描记录；新记录使用 analysis_status。
const LEGACY_PLACEHOLDER_TERMS = [
  "准备分析",
  "等待分配",
  "等待分析",
  "排队等待",
  "提取语义特征",
];

function copy(key: string, values?: ProgressCopy["values"]): ProgressCopy {
  return values ? { key, values } : { key };
}

function normalizeText(value: string | null | undefined): string {
  return String(value || "").trim();
}

function isSpecificScanItem(value: string | null | undefined, currentItemKind?: string): boolean {
  const text = normalizeText(value);
  if (currentItemKind) {
    return currentItemKind === "entry" && Boolean(text);
  }
  if (!text || GENERIC_SCAN_ITEMS.has(text)) {
    return false;
  }
  // 兼容旧版服务发来的中文阶段前缀；结构化 current_item_kind 优先。
  return !text.startsWith("已启动 ") && !text.startsWith("第 ");
}

function isCompletedItem(item: RecentAnalysisItem): boolean {
  if (item.analysis_status) {
    return item.analysis_status === "completed";
  }
  const purpose = normalizeText(item.suggested_purpose);
  const summary = normalizeText(item.summary);
  return !LEGACY_PLACEHOLDER_TERMS.some((term) => purpose.includes(term) || summary.includes(term));
}

function uniqueRecentItems(items: RecentAnalysisItem[]): RecentAnalysisItem[] {
  const seen = new Set<string>();
  const result: RecentAnalysisItem[] = [];
  for (const item of [...items].reverse()) {
    const key = normalizeText(item.item_id) || normalizeText(item.display_name);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function deriveScannerProgressViewModel(
  scanner: ScannerProgress,
  progressPercent: number,
  phase: WorkspaceProgressPhase = "analyzing",
): ScannerProgressViewModel {
  const totalCount = Math.max(0, Number(scanner.total_count || 0));
  const processedCount = Math.max(0, Number(scanner.processed_count || 0));
  const batchCount = Math.max(0, Number(scanner.batch_count || 0));
  const completedBatches = Math.max(0, Number(scanner.completed_batches || 0));
  const status = normalizeText(scanner.status || "running").toLowerCase();
  const messageKeys: Record<string, string> = {
    reading_directory: "diagnostics.scannerProgress.readingDirectory",
    reading_sources: "diagnostics.scannerProgress.readingSources",
    batch_split: "diagnostics.scannerProgress.batchSplit",
    directory_discovered: "diagnostics.scannerProgress.directoryDiscovered",
    empty_directory: "diagnostics.scannerProgress.emptyDirectory",
    scan_empty_result: "diagnostics.scannerProgress.scanEmptyResult",
    scan_completed: "diagnostics.scannerProgress.scanCompleted",
    parallel_scan_completed: "diagnostics.scannerProgress.parallelScanCompleted",
    completed_with_recovered_batches: "diagnostics.scannerProgress.completedWithRecoveredBatches",
    completed_with_review_items: "diagnostics.scannerProgress.completedWithReviewItems",
    scan_incomplete_batches: "diagnostics.scannerProgress.scanIncompleteBatches",
    scan_incomplete_items: "diagnostics.scannerProgress.scanIncompleteItems",
    scanner_failed: "diagnostics.scannerProgress.scannerFailed",
  };
  const messageCode = normalizeText(scanner.message_code);
  const messageParams = Object.fromEntries(
    Object.entries(scanner.message_params || {}).filter(([, value]) => typeof value === "string" || typeof value === "number"),
  ) as Record<string, string | number>;
  const backendMessage = messageCode && messageKeys[messageCode]
    ? copy(messageKeys[messageCode], Object.keys(messageParams).length ? messageParams : undefined)
    : null;
  const currentItemRaw = normalizeText(scanner.current_item);
  const currentItem = isSpecificScanItem(currentItemRaw, scanner.current_item_kind) ? currentItemRaw : null;
  const isRetrying = Boolean(scanner.is_retrying);
  const isApiRetrying = isRetrying && normalizeText(scanner.retry_kind) === "api";
  const isThinking = Boolean(scanner.ai_thinking);
  const isCompleted = status === "completed";
  const isAborted = status === "failed" || status === "interrupted" || status === "cancelled";
  const recentObservedItems = uniqueRecentItems(scanner.recent_analysis_items || []).slice(0, 8);
  const recentCompletedItems = recentObservedItems.filter(isCompletedItem).slice(0, 8);
  const scanLogItems = (recentCompletedItems.length > 0 ? recentCompletedItems : recentObservedItems).slice(0, 8);

  let eyebrow = copy("scanner.eyebrow.scanning");
  let title = copy("scanner.title.readingDirectory");
  let description = copy("scanner.description.discovering");
  let stageLabel = copy("scanner.stage.prepareDirectory");
  let currentItemHint = copy("scanner.hint.rangeReady");

  if (phase === "planning") {
    eyebrow = copy("scanner.eyebrow.planning");
    title = copy("scanner.title.creatingInitialPlan");
    description = copy("scanner.description.initialPlan");
    stageLabel = copy("scanner.stage.generatePlan");
    currentItemHint = copy("scanner.hint.planReview");
  } else if (phase === "stranded") {
    eyebrow = copy("scanner.eyebrow.needsAttention");
    title = copy("scanner.title.directoryReadComplete");
    description = copy("scanner.description.stranded");
    stageLabel = copy("scanner.stage.awaitingInstruction");
    currentItemHint = copy("scanner.hint.preserveBeforePlan");
  } else if (isApiRetrying) {
    eyebrow = copy("scanner.eyebrow.modelRetrying");
    title = copy("scanner.title.modelUnavailable");
    description = copy("scanner.description.modelRetrying");
    stageLabel = copy("scanner.stage.waitingModel");
    currentItemHint = copy("scanner.hint.modelRetry");
  } else if (isRetrying) {
    eyebrow = copy("scanner.eyebrow.autoChecking");
    title = copy("scanner.title.retryingAnalysis");
    description = copy("scanner.description.autoRetry");
    stageLabel = copy("scanner.stage.autoRetry");
    currentItemHint = copy("scanner.hint.retryAuto");
  } else if (isCompleted) {
    eyebrow = copy("scanner.eyebrow.completed");
    title = copy("scanner.title.directoryReadComplete");
    description = copy("scanner.description.completed");
    stageLabel = copy("scanner.stage.preparePlan");
    currentItemHint = copy("scanner.hint.switchPreview");
  } else if (phase === "discovering" || totalCount <= 0) {
    eyebrow = copy("scanner.eyebrow.scanning");
    title = copy("scanner.title.readingDirectory");
    description = copy("scanner.description.discovering");
    stageLabel = copy("scanner.stage.readDirectory");
  } else if (processedCount <= 0) {
    eyebrow = copy(isThinking ? "scanner.eyebrow.waitingFirstBatch" : "scanner.eyebrow.scanning");
    title = copy("scanner.title.firstAnalysisResults");
    description = copy(isThinking ? "scanner.description.waitingFirstBatch" : "scanner.description.queuingFirstBatch");
    stageLabel = copy(batchCount > 0 ? "scanner.stage.createBatches" : "scanner.stage.startAnalysis");
    currentItemHint = copy("scanner.hint.nextCompletedItems");
  } else if (batchCount > 0 && completedBatches < batchCount) {
    eyebrow = copy("scanner.eyebrow.analyzing");
    title = copy("scanner.title.analyzingFiles");
    description = copy("scanner.description.parallelBatch", {
      current: Math.min(completedBatches + 1, batchCount),
      total: batchCount,
    });
    stageLabel = copy("scanner.stage.analyzeInParallel");
    currentItemHint = copy("scanner.hint.nextBatch");
  } else if (totalCount > 0 && processedCount >= totalCount) {
    eyebrow = copy("scanner.eyebrow.preparingPlan");
    title = copy("scanner.title.summarizing");
    description = copy("scanner.description.summarizing");
    stageLabel = copy("scanner.stage.summarize");
    currentItemHint = copy("scanner.hint.summarizeTransition");
  } else {
    eyebrow = copy("scanner.eyebrow.analyzing");
    title = copy("scanner.title.analyzingFiles");
    description = copy("scanner.description.continuingAnalysis");
    stageLabel = copy("scanner.stage.analyzeContent");
    currentItemHint = copy("scanner.hint.updatePlan");
  }

  const isIndeterminate = totalCount <= 0 || processedCount <= 0;
  const boundedProcessed = Math.min(processedCount, totalCount);
  const progressText = totalCount <= 0 || processedCount <= 0
    ? null
    : copy(isCompleted ? "scanner.metrics.progressExact" : "scanner.metrics.progressApprox", {
      processed: boundedProcessed,
      total: totalCount,
    });
  const batchLabel = batchCount > 0
    ? copy("scanner.metrics.batchLabel", {
      current: Math.min(completedBatches + (isCompleted ? 0 : 1), Math.max(batchCount, 1)),
      total: batchCount,
    })
    : null;
  const batchDetail = batchCount > 0
    ? copy("scanner.metrics.batchDetail", { completed: Math.min(completedBatches, batchCount) })
    : null;
  const countLabel = totalCount > 0
    ? copy("scanner.metrics.countLabel", { count: totalCount, processed: boundedProcessed, total: totalCount })
    : copy("scanner.metrics.countUnknown");

  const progressSteps: ScannerDisplayStep[] = [
    {
      id: "discover",
      title: copy("scanner.steps.discover.title"),
      detail: totalCount > 0
        ? copy("scanner.steps.discover.found", { count: totalCount })
        : copy("scanner.steps.discover.confirming"),
      state: phase === "discovering" ? "active" : totalCount > 0 || isCompleted || phase === "planning" || phase === "ready" ? "done" : isAborted ? "aborted" : "active",
    },
    {
      id: "analyze",
      title: copy("scanner.steps.analyze.title"),
      detail: progressText
        || (currentItem
          ? copy("scanner.steps.analyze.currentItem", { item: currentItem })
          : isThinking
            ? copy("scanner.steps.analyze.waiting")
            : copy("scanner.steps.analyze.preparing")),
      state: phase === "planning" || phase === "ready" ? "done" : isCompleted ? "done" : isAborted && totalCount > 0 ? "aborted" : totalCount > 0 ? "active" : "pending",
    },
    {
      id: "summarize",
      title: copy(isRetrying ? "scanner.steps.summarize.retryTitle" : "scanner.steps.summarize.title"),
      detail: copy(
        phase === "planning" ? "scanner.steps.summarize.planning"
          : phase === "stranded" ? "scanner.steps.summarize.stranded"
            : isCompleted ? "scanner.steps.summarize.completed"
              : isRetrying ? "scanner.steps.summarize.retrying"
                : "scanner.steps.summarize.pending",
      ),
      state: phase === "planning" ? "active" : phase === "ready" ? "done" : phase === "stranded" ? "aborted" : isCompleted ? "done" : isRetrying ? "active" : "pending",
    },
  ];

  return {
    phase,
    eyebrow,
    title,
    description,
    backendMessage,
    stageLabel,
    totalCount,
    processedCount,
    progressPercent: Math.max(0, Math.min(100, Math.round(progressPercent))),
    progressText,
    batchLabel,
    batchDetail,
    countLabel,
    currentItem,
    currentItemHint,
    reassureText: copy("scanner.metrics.readOnlyReassurance"),
    isIndeterminate,
    recentCompletedItems,
    recentObservedItems,
    scanLogItems,
    steps: progressSteps,
  };
}
