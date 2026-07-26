"use client";

import { useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  ArrowRight,
  Activity,
  History as HistoryIcon,
  Undo2,
  PlayCircle,
  Search,
  Trash2,
  ShieldCheck,
  FileClock,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn, formatDisplayDate, } from "@/lib/utils";
import { localizeSessionLastError, localizeUserFacingError } from "@/lib/user-facing-copy";
import { useRouter, useSearchParams } from "next/navigation";

import type { JournalSummary, HistoryItem, SessionSnapshot, RollbackPrecheckSummary } from "@/types/session";
import { RollbackPreviewDialog } from "@/components/workspace/rollback-preview-dialog";
import { Button } from "@/components/ui/button";
import { ErrorAlert } from "@/components/ui/error-alert";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  clearActiveWorkspaceRouteForSession,
  getHistoryEntryName,
  getHistoryEntrySummary,
  getHistoryEntryHref,
  getHistoryEntryReadonlyHref,
  getHistoryDeletePrompt,
  isHistoryCompletedEntry,
  isHistoryPartialFailureEntry,
  isHistoryRollbackPartialFailureEntry,
  isHistoryRolledBackEntry,
  isHistorySessionEntry,
  useHistoryList,
} from "@/lib/use-history-list";

function formatPath(path: string) {
  const segments = path.split(/[\\/]/);
  if (segments.length > 4) {
    return `.../${segments.slice(-4).join("/")}`;
  }
  return path;
}

function formatMovePath(path: string | null, baseDir: string) {
  if (!path) {
    return "—";
  }

  const normalizedPath = path.replace(/\\/g, "/");
  const normalizedBaseDir = baseDir.replace(/\\/g, "/").replace(/\/$/, "");
  if (normalizedPath.toLowerCase().startsWith(normalizedBaseDir.toLowerCase())) {
    const relative = normalizedPath.slice(normalizedBaseDir.length).replace(/^\/+/, "");
    return relative || ".";
  }
  return formatPath(normalizedPath);
}

function getDirectoryShortName(path: string | null) {
  if (!path) return "未指定目录";
  const segments = path.replace(/[\\/]$/, "").split(/[\\/]/);
  const last = segments[segments.length - 1];
  return last || path;
}

function getSessionRecoveryCopy(entry: HistoryItem | null, detail: SessionSnapshot | null) {
  const status = String(detail?.stage || entry?.status || "").toLowerCase();
  if (status === "draft" || status === "idle") {
    return {
      title: "任务还没开始扫描",
      description: "可以回到工作区继续读取目录并生成第一版整理方案。",
      primaryLabel: "继续并扫描",
      secondaryLabel: "只读查看",
    };
  }
  if (status === "scanning") {
    return {
      title: "任务正在读取目录",
      description: "打开工作区可查看当前扫描进度；如果后台已中断，工作区会给出恢复动作。",
      primaryLabel: "查看进度",
      secondaryLabel: "只读查看",
    };
  }
  if (status === "planning") {
    return {
      title: "方案仍在整理或可继续调整",
      description: "回到工作区后可以继续生成、修改方案，或在方案就绪后进行移动前检查。",
      primaryLabel: "继续处理任务",
      secondaryLabel: "只读查看",
    };
  }
  if (status === "ready_for_precheck") {
    return {
      title: "方案已准备好检查",
      description: "建议先做移动前安全检查，确认无冲突后再执行整理。",
      primaryLabel: "去做安全检查",
      secondaryLabel: "只读查看",
    };
  }
  if (status === "ready_to_execute") {
    return {
      title: "安全检查已通过",
      description: "可以回到工作区复核检查结果，并输入确认后执行移动。",
      primaryLabel: "继续执行前确认",
      secondaryLabel: "只读查看",
    };
  }
  if (status === "interrupted" || status === "stale") {
    return {
      title: status === "stale" ? "目录内容已变化" : "任务曾经中断",
      description: "建议回到工作区重新扫描，先确认目录状态再继续。",
      primaryLabel: "恢复任务",
      secondaryLabel: "只读查看",
    };
  }
  return {
    title: "任务尚未完成",
    description: "可以继续之前的工作区状态，或只读查看这条任务记录。",
    primaryLabel: "继续处理任务",
    secondaryLabel: "只读查看",
  };
}

export default function HistoryPage() {
  const APP_CONTEXT_EVENT = "file-pilot-context-change";
  const HISTORY_CONTEXT_KEY = "history_header_context";
  const searchParams = useSearchParams();
  const requestedEntryId = searchParams.get("entry_id");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [journal, setJournal] = useState<JournalSummary | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionSnapshot | null>(null);
  const [detailQuery, setDetailQuery] = useState("");
  const [journalLoading, setJournalLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [rollbackResult, setRollbackResult] = useState<{
    successCount: number | null;
    attemptedCount: number | null;
    failureCount: number;
  } | null>(null);
  const [rollbackConfirmOpen, setRollbackConfirmOpen] = useState(false);
  const [rollbackPrecheck, setRollbackPrecheck] = useState<RollbackPrecheckSummary | null>(null);
  const requestedEntryHandledRef = useRef<string | null>(null);
  const router = useRouter();
  const {
    api,
    history,
    loading,
    error,
    setError,
    query,
    setQuery,
    filter,
    setFilter,
    filteredHistory,
    pendingDeleteId,
    deletingId,
    requestDelete,
    cancelDelete,
    confirmDelete,
    loadHistory,
  } = useHistoryList();

  async function loadJournal(id: string, options: { preserveRollbackResult?: boolean } = {}) {
    setJournalLoading(true);
    setDetailError(null);
    if (!options.preserveRollbackResult) {
      setRollbackResult(null);
    }
    try {
      const data = await api.getJournal(id);
      setJournal(data);
    } catch (err) {
      console.error(err);
      setJournal(null);
      setDetailError(localizeUserFacingError(err, "读取记录详情失败，请稍后再试。"));
    } finally {
      setJournalLoading(false);
    }
  }

  async function loadSessionDetail(id: string) {
    setJournalLoading(true);
    setDetailError(null);
    setRollbackResult(null);
    try {
      const data = await api.getSession(id);
      setSessionDetail(data.session_snapshot);
    } catch (err) {
      console.error(err);
      setSessionDetail(null);
      setDetailError(localizeUserFacingError(err, "读取记录详情失败，请稍后再试。"));
    } finally {
      setJournalLoading(false);
    }
  }

  const selectedEntry = filteredHistory.find((entry) => entry.execution_id === selectedSessionId)
    ?? history.find((entry) => entry.execution_id === selectedSessionId)
    ?? null;
  const isSelectedSession = Boolean(selectedEntry && isHistorySessionEntry(selectedEntry));
  const pendingDeleteEntry = pendingDeleteId
    ? history.find((entry) => entry.execution_id === pendingDeleteId) ?? null
    : null;
  const pendingDeletePrompt = getHistoryDeletePrompt(pendingDeleteEntry);

  useEffect(() => {
    if (requestedEntryHandledRef.current !== requestedEntryId) {
      requestedEntryHandledRef.current = null;
    }
  }, [requestedEntryId]);

  useEffect(() => {
    if (!selectedEntry || !selectedSessionId) {
      return;
    }
    setJournal(null);
    setSessionDetail(null);
    setDetailQuery("");
    setDetailError(null);
    if (isSelectedSession) {
      void loadSessionDetail(selectedSessionId);
      return;
    }
    void loadJournal(selectedSessionId);
  }, [isSelectedSession, selectedEntry, selectedSessionId]);

  useEffect(() => {
    if (!requestedEntryId || requestedEntryHandledRef.current === requestedEntryId || history.length === 0) {
      return;
    }
    const requestedEntry = history.find((entry) => entry.execution_id === requestedEntryId);
    if (!requestedEntry) {
      requestedEntryHandledRef.current = requestedEntryId;
      return;
    }
    setSelectedSessionId(requestedEntry.execution_id);
    requestedEntryHandledRef.current = requestedEntryId;
  }, [history, requestedEntryId]);

  useEffect(() => {
    if (!filteredHistory.length) {
      setSelectedSessionId(null);
      return;
    }

    if (requestedEntryId && requestedEntryHandledRef.current === requestedEntryId && selectedSessionId !== requestedEntryId) {
      return;
    }

    const exists = filteredHistory.some((entry) => entry.execution_id === selectedSessionId);
    if (!exists) {
      setSelectedSessionId(filteredHistory[0].execution_id);
    }
  }, [filteredHistory, requestedEntryId, selectedSessionId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!selectedEntry) {
      window.localStorage.setItem(
        HISTORY_CONTEXT_KEY,
        JSON.stringify({ detail: "会话与执行档案" }),
      );
      window.dispatchEvent(new Event(APP_CONTEXT_EVENT));
      return;
    }
    window.localStorage.setItem(
        HISTORY_CONTEXT_KEY,
        JSON.stringify({
          detail: `${getHistoryEntryName(selectedEntry)} · ${getHistoryEntrySummary(selectedEntry)}`,
        }),
      );
    window.dispatchEvent(new Event(APP_CONTEXT_EVENT));
  }, [APP_CONTEXT_EVENT, HISTORY_CONTEXT_KEY, selectedEntry]);

  const handleRollback = async (isConfirm: boolean = false) => {
    if (!journal || !selectedSessionId) return;
    setActionLoading(true);
    setError(null);
    try {
      const response = await api.rollback(selectedSessionId, isConfirm);

      if (!isConfirm && response.rollback_precheck) {
        setRollbackPrecheck(response.rollback_precheck);
        setRollbackConfirmOpen(true);
      } else {
        setRollbackConfirmOpen(false);
        setRollbackPrecheck(null);
        const rollbackReport = response.session_snapshot.rollback_report;
        setRollbackResult({
          successCount: rollbackReport?.success_count ?? null,
          attemptedCount: rollbackPrecheck?.actions.length ?? null,
          failureCount: rollbackReport?.failure_count ?? 0,
        });
        await loadHistory();
        void loadJournal(selectedSessionId, { preserveRollbackResult: true });
      }
    } catch (err) {
      setError(localizeUserFacingError(err, "回退过程中发生错误。"));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteHistory = async () => {
    const entryToDelete = pendingDeleteId
      ? history.find((entry) => entry.execution_id === pendingDeleteId) ?? null
      : null;
    const deletedId = await confirmDelete();
    if (deletedId && entryToDelete && isHistorySessionEntry(entryToDelete)) {
      clearActiveWorkspaceRouteForSession(deletedId);
    }
    if (deletedId && selectedSessionId === deletedId) {
      setSelectedSessionId(null);
      setJournal(null);
      setSessionDetail(null);
    }
  };

  const retryDetailLoad = () => {
    if (!selectedSessionId) {
      return;
    }
    if (isSelectedSession) {
      void loadSessionDetail(selectedSessionId);
      return;
    }
    void loadJournal(selectedSessionId);
  };

  const handleOpenSession = (readOnly = false) => {
    if (!selectedEntry || !isHistorySessionEntry(selectedEntry) || !selectedSessionId) return;
    router.push(readOnly ? getHistoryEntryReadonlyHref(selectedEntry) : getHistoryEntryHref(selectedEntry));
  };

  const moveRows = journal?.restore_items?.length
    ? journal.restore_items
    : journal?.items?.filter((it) => it.action_type === "MOVE") ?? [];

  const filteredMoveRows = moveRows.filter((item) => {
    if (!detailQuery) return true;
    const q = detailQuery.toLowerCase();
    return (
      item.display_name?.toLowerCase().includes(q) ||
      item.source?.toLowerCase().includes(q) ||
      item.target?.toLowerCase().includes(q)
    );
  });

  const activeCount = history.filter((item) => isHistorySessionEntry(item)).length;
  const completedCount = history.filter((item) => isHistoryCompletedEntry(item)).length;
  const partialFailureCount = history.filter((item) => isHistoryPartialFailureEntry(item)).length;
  const rollbackCount = history.filter((item) => isHistoryRolledBackEntry(item)).length;
  const historyStats = [
    { id: "all", label: "全部", value: history.length, icon: HistoryIcon, color: "text-on-surface" },
    { id: "active", label: "进行中", value: activeCount, icon: Activity, color: "text-primary" },
    { id: "completed", label: "已完成", value: completedCount, icon: CheckCircle2, color: "text-success" },
    { id: "partial_failure", label: "部分失败", value: partialFailureCount, icon: AlertCircle, color: "text-warning" },
    { id: "rolled_back", label: "已回退", value: rollbackCount, icon: Undo2, color: "text-ui-muted" },
  ] as const;

  const sessionRecoveryCopy = getSessionRecoveryCopy(selectedEntry, sessionDetail);
  const sessionDetailInterior = (
    <div className="space-y-4">
      <div className="group flex items-center justify-between gap-4 rounded-xl border border-primary/18 bg-gradient-to-r from-primary/[0.045] to-primary/[0.01] p-4">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-white border border-primary/25 transition-transform group-hover:scale-105">
            <PlayCircle className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h3 className="text-[14px] font-black tracking-tight text-on-surface">{sessionRecoveryCopy.title}</h3>
            <div className="mt-0.5 flex items-center gap-2">
              <p className="text-[11px] font-bold text-ui-muted opacity-60">已扫描得到 {sessionDetail?.plan_snapshot?.stats?.move_count || 0} 个整理项</p>
              <div className="h-1 w-1 rounded-full bg-ui-muted/30" />
              <p className="text-[11px] font-bold text-ui-muted opacity-60">
                最后更新: {formatDisplayDate(sessionDetail?.updated_at || "")}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => handleOpenSession(true)} className="h-8.5 rounded-lg px-4 text-[11px] font-black">
            {sessionRecoveryCopy.secondaryLabel}
          </Button>
          <Button variant="primary" onClick={() => handleOpenSession(false)} className="h-8.5 rounded-lg px-5 text-[11px] font-black">
            {sessionRecoveryCopy.primaryLabel}
          </Button>
        </div>
      </div>

      <div className="rounded-[9px] border border-primary/12 bg-surface-container-lowest px-4 py-3">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary/70" />
          <div>
            <p className="text-[13px] font-black text-on-surface">推荐下一步</p>
            <p className="mt-1 text-[12.5px] leading-5 text-ui-muted/75">{sessionRecoveryCopy.description}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-1">
        <div className="rounded-xl border border-on-surface/8 bg-on-surface/[0.02] p-5">
           <div className="mb-2 flex items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-ui-muted opacity-40">会话摘要</span>
              <div className="h-px flex-1 bg-on-surface/5" />
           </div>
           <p className="text-[13.5px] font-medium leading-relaxed text-on-surface/80">
             {sessionDetail?.summary || "这是一条未完成的整理记录，你可以继续之前的操作。"}
           </p>
        </div>
      </div>

      {sessionDetail?.last_error && (
        <ErrorAlert 
          title="上次任务中断" 
          message={localizeSessionLastError(sessionDetail.last_error)} 
        />
      )}
    </div>
  );

  const journalInterior = (
    <div className="space-y-6">
      {rollbackResult && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 rounded-lg bg-success/5 border border-success/10 p-3.5"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-success/10 text-success-dim">
            <Undo2 className="h-3.5 w-3.5" />
          </div>
          <div className="flex-1">
            <h3 className="text-[13px] font-black text-on-surface">
              {rollbackResult.failureCount > 0
                ? "回退部分完成"
                : rollbackResult.successCount !== null
                  ? "回退完成"
                  : "回退已执行"}
            </h3>
            <p className="text-[11.5px] font-medium text-ui-muted opacity-70">
              {rollbackResult.successCount !== null
                ? `成功恢复 ${rollbackResult.successCount} 项`
                : rollbackResult.attemptedCount !== null
                  ? `已尝试回退 ${rollbackResult.attemptedCount} 项，请在目录中确认结果`
                  : "已执行回退，请在目录中确认结果"}
              {rollbackResult.failureCount > 0 ? `，仍有 ${rollbackResult.failureCount} 项失败。` : "。"}
            </p>
          </div>
        </motion.div>
      )}

      <div className="flex flex-wrap items-center gap-6 px-1 py-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[11.5px] font-bold text-ui-muted/65">已整理项</span>
          <span className="text-[19px] font-black tabular-nums text-on-surface/90">{journal?.item_count || 0}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[11.5px] font-bold text-ui-muted/65">成功</span>
          <span className="text-[19px] font-black tabular-nums text-success-dim">{journal?.success_count || 0}</span>
        </div>
        {Boolean(journal?.failure_count) && (
          <div className="flex items-baseline gap-2">
            <span className="text-[11.5px] font-bold text-ui-muted/65 text-error/80">失败</span>
            <span className="text-[19px] font-black tabular-nums text-error">{journal?.failure_count}</span>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-on-surface/8 pb-3 px-1">
          <div className="flex items-center gap-2">
            <FileClock className="h-4 w-4 text-primary/60" />
            <h3 className="text-[13px] font-black uppercase tracking-[0.1em] text-on-surface/80">变更执行明细</h3>
          </div>

          {!rollbackResult && (journal?.status === "completed" || journal?.status === "partial_failure") && (
            <Button
              variant="danger"
              onClick={() => void handleRollback(false)}
              disabled={actionLoading}
              loading={actionLoading}
              className="h-7.5 rounded-md px-4 text-[10.5px] font-black"
            >
              <Undo2 className="h-3 w-3" />
              回退执行
            </Button>
          )}
        </div>

        {/* 局部检索栏 */}
        {moveRows.length > 0 && (
          <div className="relative mx-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ui-muted opacity-50" />
            <input
              value={detailQuery}
              onChange={(e) => setDetailQuery(e.target.value)}
              placeholder="过滤明细文件名或路径..."
              className="w-full rounded-[6px] border border-on-surface/10 bg-on-surface/[0.015] py-1.5 pl-9 pr-14 text-[12px] font-medium text-on-surface outline-none transition-all placeholder:text-ui-muted/50 focus:bg-surface focus:ring-2 focus:ring-primary/5"
            />
            {detailQuery && (
              <button
                onClick={() => setDetailQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-black text-primary hover:text-primary-dark transition-colors"
              >
                清除
              </button>
            )}
          </div>
        )}

        <div className="rounded-lg border border-on-surface/8 bg-on-surface/[0.01] overflow-hidden">
          <div className="flex flex-col divide-y divide-on-surface/6">
            {filteredMoveRows.length ? (
              filteredMoveRows.map((item, index) => {
                const isRolledBack = selectedEntry ? isHistoryRolledBackEntry(selectedEntry) : false;
                return (
                  <div 
                    key={index} 
                    className={cn(
                      "group flex flex-col p-2.5 transition-colors",
                      isRolledBack 
                        ? "bg-on-surface/[0.003] opacity-60 grayscale hover:opacity-85 hover:grayscale-[50%] duration-200" 
                        : "hover:bg-primary/[0.015]"
                    )}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={cn(
                          "h-1.5 w-1.5 rounded-full shrink-0",
                          isRolledBack ? "bg-ui-muted/30" : "bg-primary/45"
                        )} />
                        <span className={cn(
                          "text-[12.5px] font-black truncate",
                          isRolledBack ? "text-ui-muted/80 line-through" : "text-on-surface/90"
                        )} title={item.display_name}>
                          {item.display_name}
                        </span>
                      </div>
                    </div>
                    
                    <div className="mt-1 pl-3.5 flex items-center justify-between gap-4 text-[11px]">
                      <div className="flex-1 min-w-0 truncate" title={item.source || ""}>
                        <span className={cn(
                          "text-[9.5px] font-bold uppercase tracking-wider mr-1.5",
                          isRolledBack ? "text-ui-muted/30" : "text-ui-muted/45"
                        )}>FROM:</span>
                        <span className="font-mono text-ui-muted/70">{formatMovePath(item.source, journal?.target_dir || "")}</span>
                      </div>
                      
                      <div className="flex flex-col items-center shrink-0 text-ui-muted/30 px-2 min-w-[75px]">
                        <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5 group-hover:text-primary/40" />
                        {isRolledBack && (
                          <span className="mt-0.5 text-[8.5px] font-black text-ui-muted/40 whitespace-nowrap scale-90 select-none">[已撤销复原]</span>
                        )}
                      </div>

                      <div className="flex-1 min-w-0 truncate" title={item.target || ""}>
                        <span className={cn(
                          "text-[9.5px] font-bold uppercase tracking-wider mr-1.5",
                          isRolledBack ? "text-ui-muted/30" : "text-primary/40"
                        )}>TO:</span>
                        <span className={cn(
                          "font-mono font-bold",
                          isRolledBack ? "text-ui-muted/60" : "text-primary/75"
                        )}>{formatMovePath(item.target, journal?.target_dir || "")}</span>
                      </div>
                    </div>
                  </div>
                );
              })
            ) : moveRows.length ? (
              <div className="flex flex-col items-center justify-center py-14 text-center opacity-30">
                <Search className="h-7 w-7 mb-2 text-ui-muted" />
                <p className="text-[12px] font-black text-ui-muted">未检索到匹配的明细</p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center opacity-30">
                <HistoryIcon className="h-8 w-8 mb-4" />
                <p className="text-[12px] font-bold">没有可显示的变更明细</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex-1 min-h-0 overflow-hidden bg-surface">
      <div className="flex h-full min-h-0 flex-row overflow-hidden">
        <section className="flex min-h-0 w-[300px] shrink-0 flex-col border-r border-on-surface/8 bg-surface-container-lowest 2xl:w-[340px]">
          <div className="px-5 py-5">
            <div className="space-y-4">
              <div className="space-y-1.5 px-1">
                <div className="text-ui-label">
                  工作区
                </div>
                <h1 className="text-ui-h2 tracking-tight text-on-surface">
                  整理历史记录
                </h1>
              </div>
              
              <div className="flex flex-wrap gap-2 px-1">
                {historyStats.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setFilter(item.id)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] border transition-all duration-200 outline-none select-none active:scale-[0.96]",
                      filter === item.id
                        ? "bg-primary/[0.09] border-primary/35 text-primary shadow-[inset_0_1px_2px_rgba(var(--primary-rgb),0.05),0_2px_6px_rgba(var(--primary-rgb),0.06)]"
                        : "bg-on-surface/[0.01] border-on-surface/5 hover:bg-on-surface/[0.04] hover:border-on-surface/12 hover:text-on-surface hover:scale-[1.01] text-ui-muted"
                    )}
                  >
                    <div className={cn("text-[12px] font-black tabular-nums leading-none", item.color)}>
                      {item.value}
                    </div>
                    <div className="text-[12px] font-bold text-ui-muted/55">
                      {item.label}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="px-5 py-2">
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ui-muted opacity-50" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索时间、路径或记录 ID..."
                  className="w-full rounded-[6px] border border-on-surface/10 bg-on-surface/[0.02] py-2 pl-[2.25rem] pr-4 text-[12.5px] font-medium text-on-surface outline-none transition-all placeholder:text-ui-muted/50 focus:bg-surface focus:ring-2 focus:ring-primary/5"
                />
              </div>
            </div>
          </div>

          <div className="relative flex-1 overflow-y-auto px-2 py-4 scrollbar-thin">
            {loading ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 opacity-30">
                <Activity className="h-6 w-6 animate-spin text-primary" />
                <p className="text-[12px] font-bold">正在读取记录...</p>
              </div>
            ) : filteredHistory.length > 0 ? (
              <div className="space-y-0.5">
                {filteredHistory.map((entry, idx) => {
                  const active = selectedSessionId === entry.execution_id;
                  const sessionLike = isHistorySessionEntry(entry);
                  const isRolledBack = isHistoryRolledBackEntry(entry);
                  const isPartialFailure = isHistoryPartialFailureEntry(entry) || isHistoryRollbackPartialFailureEntry(entry);
                  const statusSummary = getHistoryEntrySummary(entry);
                  const dirShortName = getDirectoryShortName(entry.target_dir);

                  return (
                    <motion.div
                      key={entry.execution_id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: Math.min(idx * 0.01, 0.2), duration: 0.2 }}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedSessionId(entry.execution_id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedSessionId(entry.execution_id);
                        }
                      }}
                      className={cn(
                        "group relative flex cursor-pointer flex-col gap-1 rounded-md px-3 py-2 transition-colors text-left outline-none",
                        active
                          ? "bg-primary/[0.08] border-primary/20"
                          : "bg-transparent border-transparent hover:bg-on-surface/[0.035]",
                        isRolledBack && "opacity-60 saturate-50 hover:opacity-90 hover:saturate-100 transition-all",
                      )}
                      style={{ borderWidth: '1px', borderStyle: 'solid' }}
                    >
                      {active && (
                        <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-primary" />
                      )}

                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            sessionLike ? "bg-primary" : isRolledBack ? "bg-on-surface/20" : isPartialFailure ? "bg-warning" : "bg-success",
                          )} />
                          <h3 className={cn(
                            "truncate text-[12.5px] font-black tracking-tight",
                            active ? "text-primary" : "text-on-surface/85",
                            isRolledBack && "text-ui-muted line-through opacity-70"
                          )}>
                            {dirShortName}
                          </h3>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 transition-all duration-300 ease-out group-hover:opacity-0 group-hover:-translate-x-3 group-hover:scale-95 group-hover:pointer-events-none">
                          <span className={cn(
                            "rounded-[4px] border px-1.5 py-0.5 text-[10.5px] font-bold",
                            active
                              ? "bg-primary/10 border-primary/20 text-primary/80"
                              : isPartialFailure
                                ? "bg-warning/5 border-warning/10 text-warning"
                                : isRolledBack
                                  ? "bg-on-surface/[0.03] border-on-surface/10 text-ui-muted/60"
                                  : "bg-success/5 border-success/10 text-success-dim/80"
                          )}>
                            {statusSummary}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        <p className="truncate text-[11px] font-medium text-ui-muted/55 flex-1" title={entry.target_dir}>
                          {formatPath(entry.target_dir)}
                        </p>
                        <span className="shrink-0 font-mono text-[10.5px] font-medium text-ui-muted/45 transition-all duration-300 ease-out group-hover:opacity-0 group-hover:-translate-x-3 group-hover:pointer-events-none">
                          {formatDisplayDate(entry.created_at)}
                        </span>
                      </div>
                      
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          requestDelete(entry.execution_id);
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-[6px] p-1.5 text-error/55 opacity-0 scale-75 translate-x-4 transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] bg-surface-container-highest/90 border border-on-surface/4 shadow-sm backdrop-blur-sm hover:bg-error/8 hover:text-error active:scale-90 group-hover:opacity-100 group-hover:translate-x-0 group-hover:scale-100 focus:opacity-100 focus:translate-x-0 focus:scale-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center opacity-40">
                <HistoryIcon className="h-8 w-8 opacity-20" />
                <h3 className="mt-4 text-[13px] font-bold">没有发现记录</h3>
              </div>
            )}
          </div>
        </section>

        <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-surface">
          <AnimatePresence mode="wait">
            {selectedSessionId && selectedEntry && detailError ? (
              <motion.div
                key={`${selectedSessionId}-detail-error`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex h-full min-h-[24rem] flex-col items-center justify-center px-8 text-center"
              >
                <AlertCircle className="h-10 w-10 text-error/50" />
                <h3 className="mt-6 text-[15px] font-black text-on-surface">读取记录详情失败</h3>
                <p className="mt-2 max-w-xs text-[12px] font-medium leading-relaxed text-ui-muted/70">
                  {detailError}
                </p>
                <Button
                  variant="secondary"
                  onClick={retryDetailLoad}
                  disabled={journalLoading}
                  className="mt-5 h-8.5 rounded-lg px-5 text-[11px] font-black"
                >
                  重试
                </Button>
              </motion.div>
            ) : selectedSessionId && selectedEntry && (isSelectedSession ? sessionDetail : journal) ? (
              <motion.div
                key={selectedSessionId}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex min-h-0 flex-1 flex-col"
              >
                <div className="sticky top-0 z-10 shrink-0 border-b border-on-surface/8 bg-surface/95 px-6 py-3.5 backdrop-blur-md lg:px-8">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                       <h2 className={cn(
                         "truncate text-[15px] font-black tracking-tight text-on-surface",
                         selectedEntry && isHistoryRolledBackEntry(selectedEntry) && "line-through text-ui-muted/60"
                       )}>
                         {getDirectoryShortName(selectedEntry.target_dir)}
                       </h2>
                       <div className="h-4 w-px bg-on-surface/10 shrink-0" />
                       <div className="flex min-w-0 items-center gap-2">
                         <div className="shrink-0 text-[12px] font-bold text-ui-muted/55">
                           {isSelectedSession ? "任务记录" : "执行结果"}
                         </div>
                         <div className="hidden min-w-0 items-center gap-1.5 truncate text-[11px] font-medium text-ui-muted/60 xl:flex">
                           <FolderOpen className="h-3 w-3 shrink-0 opacity-40" />
                           <span className="truncate">{selectedEntry.target_dir}</span>
                         </div>
                       </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      {(() => {
                        const entryIsRolledBack = selectedEntry ? isHistoryRolledBackEntry(selectedEntry) : false;
                        const entryIsPartialFailure = selectedEntry
                          ? isHistoryPartialFailureEntry(selectedEntry) || isHistoryRollbackPartialFailureEntry(selectedEntry)
                          : false;
                        return (
                          <div className={cn(
                            "hidden items-center gap-2 rounded-[5px] border px-2 py-1 text-[12px] font-bold sm:flex",
                            isSelectedSession
                              ? "border-primary/25 bg-primary/5 text-primary"
                              : entryIsRolledBack
                                ? "border-on-surface/15 bg-on-surface/5 text-on-surface/40"
                                : entryIsPartialFailure
                                  ? "border-warning/30 bg-warning-container/20 text-warning"
                                  : "border-success/30 bg-success/5 text-success-dim",
                          )}>
                            <span className={cn(
                              "h-1 w-1 rounded-full",
                              isSelectedSession ? "bg-primary" : entryIsRolledBack ? "bg-on-surface/30" : entryIsPartialFailure ? "bg-warning" : "bg-success",
                            )} />
                            {selectedEntry ? getHistoryEntrySummary(selectedEntry) : "—"}
                          </div>
                        );
                      })()}
 
                      {!isSelectedSession && (journal?.status === "completed" || journal?.status === "partial_failure") && (
                        <div className="flex items-center gap-1.5 rounded-[5px] border border-warning/30 bg-warning/5 px-2 py-1 text-[12px] font-bold text-warning">
                          <ShieldCheck className="h-3 w-3" />
                          <span className="hidden lg:inline">支持回退</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto bg-surface relative px-4 py-4 scrollbar-thin lg:px-6 lg:py-6">
                  {error && (
                    <div className="mb-6">
                      <ErrorAlert title="操作执行失败" message={error} onClose={() => setError(null)} />
                    </div>
                  )}
                  {journalLoading ? (
                    <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-3 opacity-30">
                      <Activity className="h-6 w-6 animate-spin text-primary" />
                      <p className="text-[12px] font-bold">正在读取详情...</p>
                    </div>
                  ) : isSelectedSession ? (
                    sessionDetailInterior
                  ) : (
                    journalInterior
                  )}
                </div>
              </motion.div>
            ) : (
              <div className="flex h-full min-h-[24rem] flex-col items-center justify-center px-8 text-center opacity-30">
                <HistoryIcon className="h-10 w-10 opacity-20" />
                <h3 className="mt-6 text-[15px] font-black text-on-surface">选择记录查看详情</h3>
                <p className="mt-2 max-w-xs text-[12px] font-medium leading-relaxed">
                  在左侧列表中点击任意任务，即可查看其执行报告、变更明细或继续处理。
                </p>
              </div>
            )}
          </AnimatePresence>
        </section>
      </div>

      <RollbackPreviewDialog
        open={rollbackConfirmOpen}
        precheck={rollbackPrecheck}
        loading={actionLoading}
        onConfirm={() => void handleRollback(true)}
        onCancel={() => {
          setRollbackConfirmOpen(false);
          setRollbackPrecheck(null);
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingDeleteId)}
        title={pendingDeletePrompt.title}
        description={pendingDeletePrompt.description}
        confirmLabel="确认删除"
        cancelLabel="取消"
        tone="danger"
        loading={Boolean(deletingId)}
        onConfirm={handleDeleteHistory}
        onCancel={cancelDelete}
      />
    </div>
  );
}
