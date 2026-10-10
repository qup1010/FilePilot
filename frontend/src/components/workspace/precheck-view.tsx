"use client";

import { AlertCircle, ArrowRight, CheckCircle2, FolderPlus, ListChecks, ShieldAlert, ShieldCheck } from "lucide-react";
import { PlanItem, PlanTargetSlot, PrecheckSummary } from "@/types/session";
import { cn } from "@/lib/utils";
import { DirectoryTreeDiff, type DirectoryTreeLeafEntry, type DirectoryTreeFilter } from "./directory-tree-diff";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
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
    target_kind?: string;
    is_review?: boolean;
    source: string;
    target: string;
}

function reviewMoveCount(summary: PrecheckSummary) {
    return (summary.move_preview || []).filter(isReviewTarget).length;
}

function isReviewTarget(move: { target?: string; target_slot_id?: string; target_kind?: string; is_review?: boolean }): boolean {
    return Boolean(move.is_review)
        || String(move.target_kind || "").toLowerCase() === "review"
        || move.target_slot_id === "Review"
        || (move.target || "").split(/[\\/]/).some((part) => part.toLowerCase() === "review");
}

function displayMoveTarget(move: EnrichedMovePreview, reviewLabel: string): string {
    if (isReviewTarget(move)) {
        return `${reviewLabel}/${move.display_name}`;
    }
    return move.target;
}

function displayNameFromMoveSource(source: string, unknownLabel: string): string {
    const normalized = String(source || "").replace(/[\\/]+$/, "");
    return normalized.split(/[\\/]/).pop() || unknownLabel;
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
    const { t } = useTranslation("common");
    const [filter, setFilter] = useState<DirectoryTreeFilter>("all");
    const suggestionTypeLabel = (type: string) => {
        if (type === "target_exists") return t("workspace.precheck.suggestion.targetExists");
        if (type === "target_name_conflict") return t("workspace.precheck.suggestion.targetNameConflict");
        return t("workspace.precheck.suggestion.conflict");
    };

    if (!summary) {
        return (
            <div className="flex h-full w-full items-center justify-center p-10 text-center">
                <div className="space-y-4">
                    <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent mx-auto" />
                    <p className="text-[14px] text-ui-muted">{t("workspace.precheck.loading")}</p>
                    {!readOnly ? (
                        <button
                            type="button"
                            onClick={onBack}
                            className="mx-auto rounded-[8px] border border-on-surface/10 bg-surface px-4 py-2 text-[12px] font-semibold text-on-surface-variant transition-colors hover:bg-on-surface/5"
                        >
                            {t("workspace.precheck.backToPlan")}
                        </button>
                    ) : null}
                </div>
            </div>
        );
    }

    const hasErrors = (summary.blocking_errors || []).length > 0;
    const hasWarnings = (summary.warnings || []).length > 0;
    const reviewCount = reviewMoveCount(summary);
    const movedItemIds = new Set((summary.move_preview || []).map((move) => move.item_id));
    const stayInPlaceItems = planItems.filter((item) => !movedItemIds.has(item.item_id));
    const stayInPlaceCount = stayInPlaceItems.length;
    const targetConflictSuggestions = summary.target_conflict_suggestions || [];
    const summaryTone = hasErrors ? "danger" : hasWarnings ? "warning" : "success";
    const planItemById = new Map(planItems.map((item) => [item.item_id, item] as const));
    const targetSlotById = new Map(targetSlots.map((slot) => [slot.slot_id, slot] as const));
    const enrichedMoves: EnrichedMovePreview[] = (summary.move_preview || []).map((move) => {
        const planItem = planItemById.get(move.item_id);
        return {
            item_id: move.item_id,
            display_name: planItem?.display_name || displayNameFromMoveSource(move.source, t("workspace.precheck.unknownItem")),
            target_slot_id: move.target_slot_id || planItem?.target_slot_id || "",
            target_kind: move.target_kind,
            is_review: move.is_review,
            source: move.source,
            target: move.target,
        };
    });
    const riskMessagesByItemId = new Map<string, string[]>();
    for (const issue of summary.issues || []) {
        if (issue.severity !== "warning") continue;
        if (issue.code !== "risky_move") continue;
        for (const itemId of issue.related_item_ids || []) {
            const existing = riskMessagesByItemId.get(itemId) || [];
            existing.push(String(issue.message || t("workspace.precheck.importantChange")));
            riskMessagesByItemId.set(itemId, existing);
        }
    }

    const statusTitle = hasErrors
        ? t("workspace.precheck.status.blocked")
        : hasWarnings
            ? t("workspace.precheck.status.warnings")
            : t("workspace.precheck.status.ready");

    const beforeTree = {
        title: t("workspace.precheck.beforeTreeTitle"),
        subtitle: t("workspace.precheck.beforeTreeDescription"),
        leafEntries: enrichedMoves.map((move) => ({ path: move.source })),
        emptyLabel: t("workspace.precheck.noSourcePaths"),
    };

    const afterTree = {
        title: t("workspace.precheck.afterTreeTitle"),
        subtitle: t("workspace.precheck.afterTreeDescription"),
        leafEntries: enrichedMoves.map<DirectoryTreeLeafEntry>((move) => ({
            path: displayMoveTarget(move, t("workspace.reviewFolderLabel")),
            status: isReviewTarget(move) ? "review" : "pending",
        })),
        directoryEntries: summary.mkdir_preview || [],
        emptyLabel: filter === "review" ? t("workspace.precheck.noReviewFiles") : t("workspace.precheck.noTargetTree"),
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
                                <h2 className="text-[14px] font-black tracking-tight text-on-surface uppercase leading-none">
                                    {statusTitle}
                                </h2>
                            </div>
                        </div>
 
                        {/* Metrics Bar - High Density Grid */}
                        <div className="grid grid-cols-3 gap-2.5">
                            {[
                                { label: t("workspace.precheck.metrics.moving"), value: summary.move_preview.length, icon: ArrowRight, color: "text-primary", bg: "bg-primary/8", iconRotate: "-45deg" },
                                { label: t("workspace.precheck.metrics.creatingFolders"), value: summary.mkdir_preview.length, icon: FolderPlus, color: "text-sky-500", bg: "bg-sky-500/8" },
                                stayInPlaceCount > 0
                                    ? { label: t("workspace.precheck.metrics.staying"), value: stayInPlaceCount, icon: ShieldCheck, color: "text-emerald-500", bg: "bg-emerald-500/8" }
                                    : { label: t("workspace.precheck.metrics.review"), value: reviewCount, icon: AlertCircle, color: reviewCount > 0 ? "text-warning" : "text-success-dim", bg: reviewCount > 0 ? "bg-warning/8" : "bg-success/8" }
                            ].map((stat, i) => (
                                <motion.div 
                                    key={i}
                                    initial={{ opacity: 0, scale: 0.96, y: 4 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    transition={{ type: "spring", stiffness: 350, damping: 28, delay: i * 0.05 }}
                                    className="flex flex-col gap-1.5 rounded-xl border border-on-surface/8 bg-surface-container-lowest p-3.5 shadow-sm transition-all hover:border-on-surface/16"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg", stat.bg)}>
                                            <stat.icon className={cn("h-3.5 w-3.5", stat.color)} style={{ transform: stat.iconRotate ? `rotate(${stat.iconRotate})` : undefined }} />
                                        </div>
                                        <div className={cn("font-mono text-[18px] font-black tabular-nums leading-none", stat.color)}>
                                            {stat.value}
                                        </div>
                                    </div>
                                    <div className="text-[11px] font-bold tracking-wider text-ui-muted/70">
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
                                <h3 className="text-[13px] font-black text-on-surface tracking-tight">{t("workspace.precheck.comparisonTitle")}</h3>
                                <p className="text-[11px] font-black text-ui-muted opacity-40 tracking-widest">{t("workspace.precheck.noMovesBeforeExecute")}</p>
                            </div>
                            {reviewCount > 0 && (
                                <div className="flex items-center gap-1 rounded-md border border-on-surface/8 bg-on-surface/[0.02] p-0.5">
                                    {[
                                        { id: "all", label: t("workspace.precheck.showAll") },
                                        { id: "review", label: t("workspace.precheck.showReviewOnly", { count: reviewCount }) },
                                    ].map((btn) => (
                                        <button
                                            key={btn.id}
                                            onClick={() => setFilter(btn.id as DirectoryTreeFilter)}
                                            className={cn(
                                                "rounded-[4px] px-3 py-1 text-[11px] font-black uppercase tracking-widest transition-all active:scale-95",
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
                                <h3 className="text-[15px] font-black font-headline text-on-surface tracking-tight">{t("workspace.precheck.itemsToMove")}</h3>
                                <div className="text-[11px] font-bold text-ui-muted opacity-40 uppercase tracking-widest">{t("workspace.precheck.itemCount", { count: enrichedMoves.length })}</div>
                            </div>
                            <div className="grid gap-3 @4xl:grid-cols-2">
                                {enrichedMoves.map((move, idx) => {
                                    const slot = move.target_slot_id ? targetSlotById.get(move.target_slot_id) : null;
                                    const isReview = isReviewTarget(move);
                                    const slotLabel = isReview
                                        ? t("workspace.reviewFolderLabel")
                                        : slot?.display_name || "";
                                    const riskMessages = riskMessagesByItemId.get(move.item_id) || [];
                                    
                                    return (
                                        <motion.div 
                                            key={move.item_id}
                                            initial={{ opacity: 0, y: 6 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: idx * 0.02, duration: 0.2 }}
                                            className="group flex flex-col rounded-lg border border-on-surface/8 bg-surface-container-lowest transition-all hover:border-on-surface/16"
                                        >
                                            <div className="p-3.5">
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <span className="truncate font-mono text-[13px] font-bold text-on-surface">
                                                            {move.display_name}
                                                        </span>
                                                        {riskMessages.length > 0 && (
                                                            <div
                                                                className="flex items-center gap-1 rounded-[4px] border border-error/20 bg-error/10 px-1.5 py-0.5 text-[11px] font-black uppercase text-error"
                                                                title={riskMessages.join("\n")}
                                                            >
                                                                <ShieldAlert className="h-2 w-2" />
                                                                {t("workspace.precheck.importantChange")}
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-1.5 opacity-50">
                                                        {slotLabel && (
                                                            <span className={cn(
                                                                "rounded-[4px] px-1 py-0.5 text-[11px] font-black tracking-widest uppercase border",
                                                                isReview ? "border-warning/30 bg-warning/10 text-warning" : "border-primary/20 bg-primary/10 text-primary/70"
                                                            )}>
                                                                {slotLabel}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="border-t border-on-surface/5 bg-on-surface/[0.01]/30 p-3">
                                                <PathDiffViewer source={move.source} target={move.target} isReview={isReview} targetKind={move.target_kind} />
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </div>
                        </section>
                    ) : null}

                    {stayInPlaceItems.length > 0 ? (
                        <section className="shrink-0 space-y-4 pb-4">
                            <div className="flex items-baseline justify-between border-b border-on-surface/8 pb-3 mb-4">
                                <div>
                                    <h3 className="text-[15px] font-black font-headline text-on-surface tracking-tight">{t("workspace.precheck.stayingItems")}</h3>
                                    <p className="text-[11px] font-medium text-ui-muted mt-0.5">{t("workspace.precheck.stayingDescription")}</p>
                                </div>
                                <div className="text-[11px] font-bold text-emerald-500 uppercase tracking-widest">{t("workspace.precheck.itemCount", { count: stayInPlaceItems.length })}</div>
                            </div>
                            <div className="grid gap-3 @4xl:grid-cols-2">
                                {stayInPlaceItems.map((item) => {
                                    const FileIcon = getFileIcon(item.display_name, item.entry_type);
                                    return (
                                        <div key={item.item_id} className="flex items-center justify-between gap-3 rounded-lg border border-on-surface/8 bg-surface-container-lowest p-3.5 shadow-sm">
                                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-on-surface/8 bg-on-surface/[0.02] text-ui-muted">
                                                    <FileIcon className="h-4 w-4" />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate font-mono text-[13px] font-bold text-on-surface">{item.display_name}</p>
                                            <p className="mt-0.5 truncate text-[11px] text-ui-muted opacity-60">{t("workspace.precheck.sourcePath", { path: item.source_relpath })}</p>
                                                </div>
                                            </div>
                                            <span className="shrink-0 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-bold text-emerald-600">{t("workspace.precheck.staying")}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    ) : null}

                    {targetConflictSuggestions.length ? (
                        <section className="shrink-0 space-y-4 pb-4">
                            <div className="border-b border-on-surface/8 pb-3 mb-4">
                                <h3 className="text-[15px] font-black font-headline tracking-tight text-on-surface">{t("workspace.precheck.conflictSuggestions")}</h3>
                            </div>
                            <div className="space-y-3">
                                {targetConflictSuggestions.map((suggestion, index) => (
                                    <div
                                        key={`${suggestion.target}-${index}`}
                                        className="rounded-lg border border-error/10 bg-error/[0.02] p-4"
                                    >
                                        <div className="mb-3 flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-error/70">{suggestionTypeLabel(suggestion.type)}</p>
                                                <p className="mt-1 truncate text-[12px] font-black text-on-surface font-mono" title={suggestion.target}>
                                                    {suggestion.target}
                                                </p>
                                            </div>
                                            <div className="shrink-0 rounded-[4px] border border-error/15 bg-error/5 px-2 py-1 text-[11px] font-black text-error">
                                                {t("workspace.precheck.itemCount", { count: suggestion.items.length })}
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            {suggestion.items.map((item) => (
                                                <div
                                                    key={`${item.item_id}-${item.suggested_target}`}
                                                    className="grid gap-2 rounded-md border border-on-surface/8 bg-on-surface/[0.02] p-3 @2xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)]"
                                                >
                                                    <div className="min-w-0">
                                                        <p className="truncate text-[12px] font-black text-on-surface" title={item.display_name || item.source}>
                                                            {item.display_name || item.source}
                                                        </p>
                                                        <p className="mt-1 truncate text-[11px] font-mono text-ui-muted" title={item.source}>
                                                            {item.source}
                                                        </p>
                                                    </div>
                                                    <div className="min-w-0">
                                                <p className="text-[11px] font-black uppercase tracking-widest text-ui-muted opacity-60">{t("workspace.precheck.suggestedTarget")}</p>
                                                        <p className="mt-1 truncate text-[11px] font-mono font-bold text-on-surface" title={item.suggested_target}>
                                                            {item.suggested_target}
                                                        </p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    ) : null}

                    {(hasErrors || hasWarnings || reviewCount > 0) ? (
                        <section className="shrink-0 space-y-4 pb-12">
                            <div className="border-b border-on-surface/8 pb-3 mb-4">
                                <h3 className="text-[15px] font-black font-headline tracking-tight text-on-surface">{t("workspace.precheck.issuesTitle")}</h3>
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
                                    const title = isBlocking ? t("workspace.precheck.issueTitle.blocking") : isWarning ? t("workspace.precheck.issueTitle.warning") : t("workspace.precheck.issueTitle.review");
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
                                                    <p className="text-[11px] font-black tracking-[0.2em] opacity-40 leading-none">{title}</p>
                                                    <p className="text-[13px] font-bold text-on-surface mt-1 truncate" title={issue.message}>{issue.message}</p>
                                                </div>
                                            </div>
                                            {onLocateIssue && issue.related_item_ids?.length ? (
                                                <Button
                                                    variant="secondary"
                                                    size="sm"
                                                    onClick={() => onLocateIssue(issue.related_item_ids, locateFilter)}
                                                    className="shrink-0 h-7 px-3 text-[11px] font-black rounded-[4px]"
                                                >
                                                    {t("workspace.precheck.locateIssue")}
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
                                <h4 className="text-[13px] font-black text-on-surface tracking-tight leading-none">{readOnly ? t("workspace.precheck.readOnlyRecord") : t("workspace.precheck.confirmMoveTitle")}</h4>
                                <p className="text-[11px] font-medium text-ui-muted opacity-70">
                                    {readOnly
                                        ? t("workspace.precheck.readOnlyDescription")
                                        : (hasErrors ? t("workspace.precheck.blockedDescription") : t("workspace.precheck.rollbackDescription"))}
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
                                    {t("workspace.precheck.backToEdit")}
                                </Button>
                                <Button
                                    onClick={onRequestExecute}
                                    disabled={isBusy || hasErrors}
                                    className="h-9 px-7 text-[11px] font-black uppercase tracking-widest rounded-md border border-primary/10 bg-primary active:bg-primary-dim"
                                >
                                    <ArrowRight className="h-4 w-4" />
                                    {t("workspace.precheck.startMoving")}
                                </Button>
                            </div>
                        ) : null}
                    </div>
                </section>
            </div>
        </div>
    );
}
