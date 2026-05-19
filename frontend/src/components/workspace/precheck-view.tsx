"use client";

import { AlertCircle, ArrowRight, CheckCircle2, FolderPlus, ListChecks, ShieldAlert } from "lucide-react";
import { PlanItem, PlanTargetSlot, PrecheckSummary } from "@/types/session";
import { cn } from "@/lib/utils";
import { DirectoryTreeDiff, type DirectoryTreeLeafEntry, type DirectoryTreeFilter } from "./directory-tree-diff";
import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { PathDiffViewer } from "./path-diff-viewer";
import { getFileIcon } from "./preview/preview-utils";

interface PrecheckViewProps {
    summary: PrecheckSummary | null;
    planItems?: PlanItem[];
    targetSlots?: PlanTargetSlot[];
    isBusy: boolean;
    readOnly?: boolean;
    onRequestExecute: () => void;
    onBack: () => void;
    onLocateIssue?: (itemIds: string[], filter?: "unresolved" | "review" | "invalidated" | "changed") => void;
}

interface EnrichedMovePreview {
    item_id: string;
    display_name: string;
    target_slot_id: string;
    source: string;
    target: string;
}

function reviewMoveCount(summary: PrecheckSummary) {
    return (summary.move_preview || []).filter((move) =>
        (move.target || "").split(/[\\/]/).some((part) => part.toLowerCase() === "review"),
    ).length;
}

function isReviewTarget(move: Pick<EnrichedMovePreview, "target" | "target_slot_id">): boolean {
    return move.target_slot_id === "Review" || (move.target || "").split(/[\\/]/).some((part) => part.toLowerCase() === "review");
}

function displayMoveTarget(move: EnrichedMovePreview): string {
    if (isReviewTarget(move)) {
        return `待确认区/${move.display_name}`;
    }
    return move.target;
}

function displayNameFromMoveSource(source: string): string {
    const normalized = String(source || "").replace(/[\\/]+$/, "");
    return normalized.split(/[\\/]/).pop() || "未知条目";
}

export function PrecheckView({
    summary,
    planItems = [],
    targetSlots = [],
    isBusy,
    readOnly = false,
    onRequestExecute,
    onBack,
    onLocateIssue,
}: PrecheckViewProps) {
    const [filter, setFilter] = useState<DirectoryTreeFilter>("all");

    if (!summary) {
        return (
            <div className="flex h-full w-full items-center justify-center p-10 text-center">
                <div className="space-y-4">
                    <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto" />
                    <p className="text-[14px] text-ui-muted">正在检查移动风险...</p>
                </div>
            </div>
        );
    }

    const hasErrors = (summary.blocking_errors || []).length > 0;
    const hasWarnings = (summary.warnings || []).length > 0;
    const reviewCount = reviewMoveCount(summary);
    const summaryTone = hasErrors ? "danger" : hasWarnings ? "warning" : "success";
    const planItemById = new Map(planItems.map((item) => [item.item_id, item] as const));
    const targetSlotById = new Map(targetSlots.map((slot) => [slot.slot_id, slot] as const));
    const enrichedMoves: EnrichedMovePreview[] = (summary.move_preview || []).map((move) => {
        const planItem = planItemById.get(move.item_id);
        return {
            item_id: move.item_id,
            display_name: planItem?.display_name || displayNameFromMoveSource(move.source),
            target_slot_id: planItem?.target_slot_id || "",
            source: move.source,
            target: move.target,
        };
    });
    const riskMessagesByItemId = new Map<string, string[]>();
    for (const issue of summary.issues || []) {
        if (issue.severity !== "warning") continue;
        const message = String(issue.message || "");
        if (!message.includes("高影响移动")) continue;
        for (const itemId of issue.related_item_ids || []) {
            const existing = riskMessagesByItemId.get(itemId) || [];
            existing.push(message);
            riskMessagesByItemId.set(itemId, existing);
        }
    }

    const statusTitle = hasErrors
        ? "当前不能执行"
        : hasWarnings
            ? "可以执行，建议先看提醒"
            : "安全检查通过";
    const statusDescription = hasErrors
        ? "发现必须先处理的问题，修复后再执行会更安全。"
        : hasWarnings
            ? "结构已经通过，但还有一些风险提醒值得先确认。"
            : "结构检查已经通过，一切就绪，可以进入执行阶段。";

    const beforeTree = {
        title: "整理前目录树",
        subtitle: "这里是这次会参与整理的原始位置。",
        leafEntries: enrichedMoves.map((move) => ({ path: move.source })),
        emptyLabel: "当前没有可检查的原始路径。",
    };

    const afterTree = {
        title: "整理后目录树",
        subtitle: "这里是执行后即将形成的目标结构。",
        leafEntries: enrichedMoves.map<DirectoryTreeLeafEntry>((move) => ({
            path: isReviewTarget(move) ? displayMoveTarget(move) : move.target,
            status: isReviewTarget(move) ? "review" : "pending",
        })),
        directoryEntries: summary.mkdir_preview || [],
        emptyLabel: filter === "review" ? "没有需要留在待确认区的文件。" : "当前没有可展示的目标目录结构。",
    };

    return (
        <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col overflow-hidden py-4 lg:px-4 @container">
            {/* Native Scrollable Page Layout */}
            <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pr-4 min-h-0">
                <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    className="shrink-0 space-y-6 pb-8"
                >
                    <section className="space-y-6">
                        {/* Status Header - Workbench Style */}
                        <div className={cn(
                            "flex items-center gap-4 rounded-lg border px-5 py-2.5",
                            summaryTone === "danger" 
                                ? "border-error/20 bg-error/[0.03] text-error" 
                                : summaryTone === "warning"
                                    ? "border-warning/20 bg-warning/[0.03] text-warning"
                                    : "border-success/20 bg-success/[0.03] text-success-dim"
                        )}>
                            <div className={cn(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-black",
                                summaryTone === "danger" ? "bg-error text-white" : summaryTone === "warning" ? "bg-warning text-white" : "bg-success text-white"
                            )}>
                                {summaryTone === "danger" ? <ShieldAlert className="h-4 w-4" /> : summaryTone === "warning" ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <span className="text-[9px] font-black tracking-widest opacity-40">检查结果</span>
                                    <span className="h-0.5 w-0.5 rounded-full bg-current opacity-20" />
                                    <span className="text-[9px] font-black uppercase tracking-widest opacity-60">SYSTEM {summaryTone}</span>
                                </div>
                                <h2 className="text-[14px] font-black tracking-tight text-on-surface mt-0.5 uppercase leading-none">
                                    {statusTitle}
                                </h2>
                            </div>
                        </div>
 
                        {/* Metrics Bar - High Density Grid */}
                        <div className="grid grid-cols-3 gap-2">
                            {[
                                { label: "将移动", value: summary.move_preview.length, icon: ArrowRight, color: "text-primary", bg: "bg-primary/5", iconRotate: "-45deg" },
                                { label: "将新建目录", value: summary.mkdir_preview.length, icon: FolderPlus, color: "text-sky-500", bg: "bg-sky-500/5" },
                                { label: "待确认", value: reviewCount, icon: AlertCircle, color: reviewCount > 0 ? "text-warning" : "text-success-dim", bg: reviewCount > 0 ? "bg-warning/5" : "bg-success/5" }
                            ].map((stat, i) => (
                                <motion.div 
                                    key={i}
                                    initial={{ opacity: 0, scale: 0.95, y: 4 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    transition={{ type: "spring", stiffness: 350, damping: 28, delay: i * 0.05 }}
                                    className="flex flex-col gap-1 rounded-md border border-on-surface/5 bg-on-surface/[0.02] p-3 transition-colors hover:bg-on-surface/[0.04]"
                                >
                                    <div className="flex items-center justify-between">
                                        <stat.icon className={cn("h-3 w-3 opacity-60", stat.color)} style={{ transform: stat.iconRotate ? `rotate(${stat.iconRotate})` : undefined }} />
                                        <div className={cn("text-[16px] font-black tabular-nums leading-none", stat.color)}>
                                            {stat.value}
                                        </div>
                                    </div>
                                    <div className="text-[9px] font-black uppercase tracking-widest text-ui-muted opacity-40">
                                        {stat.label}
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    </section>

                    <div className="mt-8 shrink-0 flex flex-col gap-10">
                        <section className="flex flex-col rounded-xl border border-on-surface/8 bg-surface-container-lowest overflow-hidden">
                        <div className="shrink-0 flex items-center justify-between bg-on-surface/[0.01] border-b border-on-surface/8 px-6 py-3.5">
                            <div className="space-y-0.5">
                                <h3 className="text-[13px] font-black text-on-surface tracking-tight">移动前后对照</h3>
                                <p className="text-[10px] font-black text-ui-muted opacity-40 tracking-widest">执行前不会移动文件</p>
                            </div>
                            {reviewCount > 0 && (
                                <div className="flex items-center gap-1 rounded-md border border-on-surface/8 bg-on-surface/[0.02] p-0.5">
                                    {[
                                        { id: "all", label: "全部显示" },
                                        { id: "review", label: `仅看待确认 (${reviewCount})` },
                                    ].map((btn) => (
                                        <button
                                            key={btn.id}
                                            onClick={() => setFilter(btn.id as DirectoryTreeFilter)}
                                            className={cn(
                                                "rounded-[4px] px-3 py-1.2 text-[10px] font-black uppercase tracking-widest transition-all",
                                                filter === btn.id
                                                    ? "bg-on-surface text-surface"
                                                    : "text-ui-muted hover:text-on-surface hover:bg-on-surface/[0.03]",
                                            )}
                                        >
                                            {btn.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="p-4 bg-surface/30">
                            <DirectoryTreeDiff before={beforeTree} after={afterTree} filter={filter} />
                        </div>
                    </section>

                    {enrichedMoves.length ? (
                        <section className="shrink-0 space-y-4 pb-4">
                            <div className="flex items-baseline justify-between border-b border-on-surface/8 pb-3 mb-4">
                                <h3 className="text-[15px] font-black font-headline text-on-surface tracking-tight">将要移动的项目</h3>
                                <div className="text-[11px] font-bold text-ui-muted opacity-40 uppercase tracking-widest">{enrichedMoves.length} 个条目</div>
                            </div>
                            <div className="grid gap-3 @4xl:grid-cols-2">
                                {enrichedMoves.map((move, idx) => {
                                    const slot = move.target_slot_id ? targetSlotById.get(move.target_slot_id) : null;
                                    const slotLabel = move.target_slot_id === "Review"
                                        ? "待确认区"
                                        : slot?.display_name || "";
                                    const isReview = isReviewTarget(move);
                                    const targetLabel = displayMoveTarget(move);
                                    const riskMessages = riskMessagesByItemId.get(move.item_id) || [];
                                    
                                    return (
                                        <motion.div 
                                            key={`${move.item_id}-${move.target}`} 
                                            initial={{ opacity: 0, y: 5 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: Math.min(idx * 0.01, 0.4), duration: 0.2 }}
                                            className={cn(
                                                "group relative rounded-md border transition-all",
                                                isReview 
                                                    ? "border-warning/30 bg-warning/[0.02]" 
                                                    : "border-on-surface/8 bg-on-surface/[0.01] hover:border-primary/40 hover:bg-primary/[0.02]"
                                            )}
                                        >
                                            <div className="flex items-start gap-3 p-3">
                                                {(() => {
                                                    const ItemIcon = getFileIcon(move.display_name);
                                                    return (
                                                        <div className={cn(
                                                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border transition-colors",
                                                            isReview
                                                                ? "border-warning/15 bg-warning/8 text-warning"
                                                                : riskMessages.length > 0
                                                                    ? "border-error/15 bg-error/8 text-error"
                                                                    : "border-on-surface/8 bg-on-surface/[0.03] text-on-surface-variant/40 group-hover:border-primary/20 group-hover:bg-primary/5 group-hover:text-primary"
                                                        )}>
                                                            <ItemIcon className="h-3.5 w-3.5" />
                                                        </div>
                                                    );
                                                })()}
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <p className="truncate text-[12px] font-black text-on-surface tracking-tight font-mono" title={move.display_name}>
                                                            {move.display_name}
                                                        </p>
                                                        {isReview && (
                                                            <div className="flex items-center gap-1 rounded-[3px] bg-warning/10 px-1.5 py-0.5 text-[8px] font-black uppercase text-warning border border-warning/20">
                                                                <AlertCircle className="h-2 w-2" />
                                                                待确认
                                                            </div>
                                                        )}
                                                        {riskMessages.length > 0 && (
                                                            <div
                                                                className="flex items-center gap-1 rounded-[3px] border border-error/20 bg-error/10 px-1.5 py-0.5 text-[8px] font-black uppercase text-error"
                                                                title={riskMessages.join("\n")}
                                                            >
                                                                <ShieldAlert className="h-2 w-2" />
                                                                高影响
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="mt-1 flex items-center gap-1.5 opacity-50">
                                                        {slotLabel && (
                                                            <span className={cn(
                                                                "rounded-[2px] px-1 py-0.5 text-[8px] font-black tracking-widest uppercase border",
                                                                isReview ? "border-warning/30 bg-warning/10 text-warning" : "border-primary/20 bg-primary/10 text-primary/70"
                                                            )}>
                                                                {slotLabel}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="border-t border-on-surface/5 bg-on-surface/[0.01]/30 p-3">
                                                <PathDiffViewer source={move.source} target={move.target} />
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </div>
                        </section>
                    ) : null}

                    {(hasErrors || hasWarnings || reviewCount > 0) ? (
                        <section className="shrink-0 space-y-4 pb-12">
                            <div className="border-b border-on-surface/8 pb-3 mb-4">
                                <h3 className="text-[15px] font-black font-headline tracking-tight text-on-surface">执行前提醒</h3>
                            </div>

                            <div className="space-y-3">
                                {(summary.issues?.length ? summary.issues : []).map((issue) => {
                                    const isBlocking = issue.severity === "blocking";
                                    const isWarning = issue.severity === "warning";
                                    const toneClass = isBlocking 
                                        ? "bg-error/[0.02] border-error/10 hover:bg-error/[0.04]" 
                                        : isWarning 
                                            ? "bg-warning/[0.02] border-warning/10 hover:bg-warning/[0.04]" 
                                            : "bg-surface-container-low/40 border-on-surface/8";
                                    const Icon = isBlocking ? AlertCircle : isWarning ? ShieldAlert : ListChecks;
                                    const title = isBlocking ? "必须先处理" : isWarning ? "执行前建议" : "核对提醒";
                                    const locateFilter = issue.severity === "review" ? "review" : undefined;
                                    
                                    return (
                                        <div key={issue.id} className={cn(
                                            "flex items-center justify-between gap-4 rounded-lg border px-4 py-3 transition-all",
                                            toneClass
                                        )}>
                                            <div className="flex items-center gap-4 min-w-0">
                                                <div className={cn(
                                                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-md font-black",
                                                    isBlocking ? "bg-error text-white" : isWarning ? "bg-warning text-white" : "bg-primary text-white"
                                                )}>
                                                    <Icon className="h-4 w-4" />
                                                </div>
                                                <div className="min-w-0">
                                                    <p className="text-[10px] font-black tracking-[0.2em] opacity-40 leading-none">{title}</p>
                                                    <p className="text-[13px] font-bold text-on-surface mt-1 truncate" title={issue.message}>{issue.message}</p>
                                                </div>
                                            </div>
                                            {onLocateIssue && issue.related_item_ids?.length ? (
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => onLocateIssue(issue.related_item_ids, locateFilter)}
                                                    className="shrink-0 h-7 px-3 text-[10.5px] font-black rounded-[4px]"
                                                >
                                                    定位问题
                                                </Button>
                                            ) : null}
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    ) : null}
                </div>
            </motion.div>
        </div>

            <div className="mt-auto shrink-0 border-t border-on-surface/8 bg-on-surface/[0.02] py-4 px-6 scale-y-[1.02] origin-bottom transition-all">
                <section className="mx-auto max-w-[1400px]">
                    <div className="flex items-center justify-between gap-10">
                        <div className="flex items-center gap-5">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
                                <ListChecks className="h-4.5 w-4.5" />
                            </div>
                            <div className="flex items-baseline gap-4">
                                <h4 className="text-[13px] font-black text-on-surface tracking-tight leading-none">{readOnly ? "安全检查记录" : "确认开始移动？"}</h4>
                                <p className="text-[11px] font-medium text-ui-muted opacity-70">
                                    {readOnly
                                        ? "当前只能查看记录，不能修改执行状态。"
                                        : (hasErrors ? "当前存在阻塞性问题，请修复后再试。" : "任务执行后支持回退最近一次产生的变更。")}
                                </p>
                            </div>
                        </div>

                        {!readOnly ? (
                            <div className="flex shrink-0 items-center gap-3">
                                <Button
                                    variant="secondary"
                                    onClick={onBack}
                                    disabled={isBusy}
                                    className="h-9 px-5 text-[11px] font-black uppercase tracking-widest rounded-md"
                                >
                                    返回修改
                                </Button>
                                <Button
                                    onClick={onRequestExecute}
                                    disabled={isBusy || hasErrors}
                                    className="h-9 px-7 text-[11px] font-black uppercase tracking-widest rounded-md border border-primary/10 bg-primary active:bg-primary-dim"
                                >
                                    <ArrowRight className="h-4 w-4" />
                                    开始移动文件
                                </Button>
                            </div>
                        ) : null}
                    </div>
                </section>
            </div>
        </div>
    );
}
