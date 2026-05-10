"use client";

import type { RecentAnalysisItem, ScannerProgress } from "@/types/session";

export type ScannerStepState = "active" | "done" | "pending" | "aborted";
export type WorkspaceProgressPhase = "discovering" | "analyzing" | "planning" | "stranded" | "ready";

export interface ScannerDisplayStep {
  id: string;
  title: string;
  detail: string;
  state: ScannerStepState;
}

export interface ScannerProgressViewModel {
  phase: WorkspaceProgressPhase;
  eyebrow: string;
  title: string;
  description: string;
  backendMessage: string | null;
  stageLabel: string;
  totalCount: number;
  processedCount: number;
  progressPercent: number;
  progressText: string | null;
  batchLabel: string | null;
  batchDetail: string | null;
  countLabel: string;
  currentItem: string | null;
  currentItemHint: string;
  reassureText: string;
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

const PLACEHOLDER_TERMS = [
  "准备分析",
  "等待分配",
  "等待分析",
  "排队等待",
  "提取语义特征",
];

function normalizeText(value: string | null | undefined): string {
  return String(value || "").trim();
}

function isSpecificScanItem(value: string | null | undefined): boolean {
  const text = normalizeText(value);
  if (!text || GENERIC_SCAN_ITEMS.has(text)) {
    return false;
  }
  return !text.startsWith("已启动 ") && !text.startsWith("第 ");
}

function isCompletedItem(item: RecentAnalysisItem): boolean {
  const purpose = normalizeText(item.suggested_purpose);
  const summary = normalizeText(item.summary);
  return !PLACEHOLDER_TERMS.some((term) => purpose.includes(term) || summary.includes(term));
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
  const backendMessage = normalizeText(scanner.message) || null;
  const currentItemRaw = normalizeText(scanner.current_item);
  const currentItem = isSpecificScanItem(currentItemRaw) ? currentItemRaw : null;
  const isRetrying = Boolean(scanner.is_retrying);
  const isApiRetrying = isRetrying && normalizeText(scanner.retry_kind) === "api";
  const isThinking = Boolean(scanner.ai_thinking);
  const isCompleted = status === "completed";
  const isAborted = status === "failed" || status === "interrupted" || status === "cancelled";
  const recentObservedItems = uniqueRecentItems(scanner.recent_analysis_items || []).slice(0, 8);
  const recentCompletedItems = recentObservedItems.filter(isCompletedItem).slice(0, 8);
  const scanLogItems = (recentCompletedItems.length > 0 ? recentCompletedItems : recentObservedItems).slice(0, 8);

  let eyebrow = "扫描进行中";
  let title = "正在读取目录结构";
  let description = "先确认目录范围，再建立第一批分析任务。";
  let stageLabel = "准备目录";
  let currentItemHint = "目录范围确认完成后，会开始显示当前正在分析的项目。";

  if (phase === "planning") {
    eyebrow = "生成方案中";
    title = "正在生成第一版整理方案";
    description = "目录读取和内容分析已经完成，FilePilot 正在整理可执行建议。";
    stageLabel = "生成方案";
    currentItemHint = "这一步会把扫描结果转换成可检查、可调整的整理方案。";
  } else if (phase === "stranded") {
    eyebrow = "需要处理";
    title = "目录读取已完成";
    description = "自动方案没有继续生成，可以补充一句整理要求继续规划，或重新扫描。";
    stageLabel = "等待指令";
    currentItemHint = "扫描结果仍在，继续规划前不会移动文件。";
  } else if (isApiRetrying) {
    eyebrow = "模型服务重试中";
    title = "模型服务暂时没有响应";
    description = "目录读取没有丢失，FilePilot 正在重试模型请求；如果连续失败，会自动结束并显示错误。";
    stageLabel = "等待模型";
    currentItemHint = "服务恢复后会继续扫描；也可以先停止扫描后稍后重试。";
  } else if (isRetrying) {
    eyebrow = "自动校验中";
    title = "正在补齐少量未完成结果";
    description = "系统发现个别结果需要重新确认，正在自动处理，不需要重新开始。";
    stageLabel = "自动重试";
    currentItemHint = "校验完成后会自动进入整理方案。";
  } else if (isCompleted) {
    eyebrow = "扫描完成";
    title = "目录读取已完成";
    description = "目录分析已经完成，正在汇总结果并准备进入整理方案。";
    stageLabel = "准备进入方案";
    currentItemHint = "整理方案准备好后会自动切换到预览。";
  } else if (phase === "discovering" || totalCount <= 0) {
    eyebrow = "扫描进行中";
    title = "正在读取目录结构";
    description = "系统先梳理目录范围，再把需要分析的项目加入队列。";
    stageLabel = "读取目录";
  } else if (processedCount <= 0) {
    eyebrow = isThinking ? "等待首批结果" : "扫描进行中";
    title = "正在建立第一批分析结果";
    description = isThinking
      ? "目录结构已读取，正在等待模型返回第一批分析结果。"
      : "目录结构已读取，系统正在分配首批分析任务。";
    stageLabel = batchCount > 0 ? "建立分析批次" : "开始内容分析";
    currentItemHint = "第一批结果返回后，这里会开始显示最近完成的项目。";
  } else if (batchCount > 0 && completedBatches < batchCount) {
    eyebrow = "内容分析中";
    title = "正在分析文件内容";
    description = `系统正在并行处理第 ${Math.min(completedBatches + 1, batchCount)} / ${batchCount} 批结果。`;
    stageLabel = "并行分析";
    currentItemHint = "当前批次完成后，会继续推进下一批项目。";
  } else if (totalCount > 0 && processedCount >= totalCount) {
    eyebrow = "准备生成方案";
    title = "正在汇总扫描结果";
    description = "主要分析已经完成，正在整理输出并准备生成整理方案。";
    stageLabel = "汇总结果";
    currentItemHint = "汇总完成后会自动切换到整理方案。";
  } else {
    eyebrow = "内容分析中";
    title = "正在分析文件内容";
    description = "FilePilot 会持续读取、归纳，并在完成后生成整理建议。";
    stageLabel = "分析内容";
    currentItemHint = "分析结果会持续补充到右侧整理方案。";
  }

  const isIndeterminate = totalCount <= 0 || processedCount <= 0;
  const progressText =
    totalCount <= 0
      ? null
      : processedCount <= 0
        ? null
        : isCompleted
          ? `${Math.min(processedCount, totalCount)} / ${totalCount}`
          : `约 ${Math.min(processedCount, totalCount)} / ${totalCount}`;

  const batchLabel =
    batchCount > 0
      ? `批次 ${Math.min(completedBatches + (isCompleted ? 0 : 1), Math.max(batchCount, 1))} / ${batchCount}`
      : null;
  const batchDetail =
    batchCount > 0
      ? `${Math.min(completedBatches, batchCount)} 个批次已完成，最多会并行处理多个批次`
      : null;
  const countLabel =
    totalCount > 0
      ? `${Math.min(processedCount, totalCount)} / ${totalCount} 项`
      : "正在统计项目";

  const progressSteps: ScannerDisplayStep[] = [
    {
      id: "discover",
      title: "读取目录结构",
      detail: totalCount > 0 ? `已发现 ${totalCount} 个待分析项目` : "正在确认目录范围",
      state: phase === "discovering" ? "active" : totalCount > 0 || isCompleted || phase === "planning" || phase === "ready" ? "done" : isAborted ? "aborted" : "active",
    },
    {
      id: "analyze",
      title: "分析项目内容",
      detail:
        progressText ||
        (currentItem ? `当前处理：${currentItem}` : isThinking ? "正在等待分析结果返回" : "准备开始分析"),
      state: phase === "planning" || phase === "ready" ? "done" : isCompleted ? "done" : isAborted && totalCount > 0 ? "aborted" : totalCount > 0 ? "active" : "pending",
    },
    {
      id: "summarize",
      title: isRetrying ? "校验少量结果" : "生成整理方案",
      detail: phase === "planning"
        ? "正在根据扫描结果生成整理建议"
        : phase === "stranded"
          ? "需要继续规划或重新扫描"
        : isCompleted
        ? "扫描分析完成，正在切换到方案视图"
        : isRetrying
          ? "正在自动重试未完成的部分"
          : "分析完成后会自动显示整理方案",
      state: phase === "planning" ? "active" : phase === "ready" ? "done" : phase === "stranded" ? "aborted" : isCompleted ? "done" : isRetrying ? "active" : totalCount > 0 ? "pending" : "pending",
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
    reassureText: "扫描期间只会读取和分析，不会移动或改写原始文件。",
    isIndeterminate,
    recentCompletedItems,
    recentObservedItems,
    scanLogItems,
    steps: progressSteps,
  };
}
