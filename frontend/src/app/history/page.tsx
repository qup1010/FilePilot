"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  FolderOpen,
  ArrowRight,
  Activity,
  History as HistoryIcon,
  Undo2,
  PlayCircle,
  Eye,
  Search,
  Trash2,
  ShieldCheck,
  PanelLeft,
  FileClock,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn, formatDisplayDate, getFriendlyStage } from "@/lib/utils";
import { useRouter } from "next/navigation";

import { getApiBaseUrl, getApiToken } from "@/lib/runtime";
import { createApiClient } from "@/lib/api";
import type { JournalSummary, HistoryItem, SessionSnapshot } from "@/types/session";
import { Button } from "@/components/ui/button";
import { ErrorAlert } from "@/components/ui/error-alert";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type HistoryFilter = "all" | "active" | "completed" | "rolled_back";

function isSessionEntry(entry: HistoryItem): boolean {
  return entry.is_session || !["success", "completed", "rolled_back", "partial_failure"].includes(entry.status);
}

function getEntryName(entry: HistoryItem): string {
  return entry.target_dir.replace(/[\\/]$/, "").split(/[\\/]/).pop() || "未命名记录";
}

function getEntrySummary(entry: HistoryItem): string {
  return isSessionEntry(entry) ? getFriendlyStage(entry.status) : entry.status === "rolled_back" ? "回退已完成" : "执行结果";
}

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

export default function HistoryPage() {
  const APP_CONTEXT_EVENT = "file-organizer-context-change";
  const HISTORY_CONTEXT_KEY = "history_header_context";
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [journal, setJournal] = useState<JournalSummary | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionSnapshot | null>(null);
  const [journalLoading, setJournalLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [rollbackSuccess, setRollbackSuccess] = useState(false);
  const [rollbackConfirmOpen, setRollbackConfirmOpen] = useState(false);
  const router = useRouter();
  const api = useMemo(() => createApiClient(getApiBaseUrl(), getApiToken()), []);

  async function loadHistory() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getHistory();
      setHistory(data);
      if (data.length > 0 && !selectedSessionId) {
        setSelectedSessionId(data[0].execution_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setLoading(false);
    }
  }

  async function loadJournal(id: string) {
    setJournalLoading(true);
    setRollbackSuccess(false);
    try {
      const data = await api.getJournal(id);
      setJournal(data);
    } catch (err) {
      console.error(err);
      setJournal(null);
    } finally {
      setJournalLoading(false);
    }
  }

  async function loadSessionDetail(id: string) {
    setJournalLoading(true);
    setRollbackSuccess(false);
    try {
      const data = await api.getSession(id);
      setSessionDetail(data.session_snapshot);
    } catch (err) {
      console.error(err);
      setSessionDetail(null);
    } finally {
      setJournalLoading(false);
    }
  }

  useEffect(() => {
    void loadHistory();
  }, []);

  const filteredHistory = useMemo(() => {
    const keyword = query.trim().toLowerCase();

    return history.filter((item) => {
      const sessionLike = isSessionEntry(item);
      const matchesFilter =
        filter === "all"
          ? true
          : filter === "active"
            ? sessionLike
            : filter === "completed"
              ? !sessionLike && item.status !== "rolled_back"
              : item.status === "rolled_back";

      if (!matchesFilter) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      const name = getEntryName(item);
      return [item.target_dir, name, item.status, item.execution_id].some((value) =>
        value.toLowerCase().includes(keyword),
      );
    });
  }, [filter, history, query]);

  const selectedEntry = filteredHistory.find((entry) => entry.execution_id === selectedSessionId)
    ?? history.find((entry) => entry.execution_id === selectedSessionId)
    ?? null;
  const isSelectedSession = Boolean(selectedEntry && isSessionEntry(selectedEntry));

  useEffect(() => {
    if (!selectedEntry || !selectedSessionId) {
      return;
    }
    setJournal(null);
    setSessionDetail(null);
    if (isSelectedSession) {
      void loadSessionDetail(selectedSessionId);
      return;
    }
    void loadJournal(selectedSessionId);
  }, [isSelectedSession, selectedEntry, selectedSessionId]);

  useEffect(() => {
    if (!filteredHistory.length) {
      setSelectedSessionId(null);
      return;
    }

    const exists = filteredHistory.some((entry) => entry.execution_id === selectedSessionId);
    if (!exists) {
      setSelectedSessionId(filteredHistory[0].execution_id);
    }
  }, [filteredHistory, selectedSessionId]);

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
        detail: `${getEntryName(selectedEntry)} · ${getEntrySummary(selectedEntry)}`,
      }),
    );
    window.dispatchEvent(new Event(APP_CONTEXT_EVENT));
  }, [APP_CONTEXT_EVENT, HISTORY_CONTEXT_KEY, selectedEntry]);

  const handleRollback = async () => {
    if (!journal || !selectedSessionId) return;
    setActionLoading(true);
    setError(null);
    try {
      await api.rollback(selectedSessionId, true);
      setRollbackConfirmOpen(false);
      setRollbackSuccess(true);
      void loadHistory();
      void loadJournal(selectedSessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "回退过程中发生错误");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteHistory = async () => {
    if (!pendingDeleteId) return;
    setActionLoading(true);
    setError(null);
    try {
      await api.deleteHistoryEntry(pendingDeleteId);
      setHistory((prev) => prev.filter((item) => item.execution_id !== pendingDeleteId));
      if (selectedSessionId === pendingDeleteId) {
        setSelectedSessionId(null);
        setJournal(null);
        setSessionDetail(null);
      }
      setPendingDeleteId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除记录时发生错误");
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenSession = (readOnly = false) => {
    if (!selectedEntry?.is_session || !selectedSessionId) return;
    const suffix = readOnly ? "&readonly=1" : "";
    router.push(`/workspace?session_id=${selectedSessionId}${suffix}`);
  };

  const moveRows = journal?.restore_items?.length
    ? journal.restore_items
    : journal?.items?.filter((it) => it.action_type === "MOVE") ?? [];

  const activeCount = history.filter((item) => isSessionEntry(item)).length;
  const completedCount = history.filter((item) => !isSessionEntry(item) && item.status !== "rolled_back").length;
  const rollbackCount = history.filter((item) => item.status === "rolled_back").length;
  const historyStats = [
    { label: "进行中", value: activeCount },
    { label: "完成", value: completedCount },
    { label: "回退", value: rollbackCount },
  ];

  return (
    <div className="flex-1 min-h-0 overflow-hidden bg-surface">
      <div className="flex h-full min-h-0 flex-col gap-3 p-3 lg:flex-row">
        <section className="flex min-h-0 w-full flex-col overflow-hidden rounded-[12px] border border-on-surface/6 bg-surface-container lg:w-[396px] lg:min-w-[396px]">
          <div className="border-b border-on-surface/6 px-4 py-4">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-2 text-ui-meta font-medium text-ui-muted">
                  <PanelLeft className="h-3.5 w-3.5" />
                  历史列表
                </div>
                <h1 className="text-[1.2rem] font-black font-headline tracking-tight text-on-surface">
                  整理记录
                </h1>
                <p className="max-w-[18rem] text-[12px] leading-5 text-ui-muted">
                  搜索、筛选并继续处理之前的会话与执行结果。
                </p>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                {historyStats.map((item) => (
                  <div key={item.label} className="rounded-[9px] border border-on-surface/6 bg-white px-3 py-2.5">
                    <div className="text-[12px] text-ui-muted">{item.label}</div>
                    <div className="mt-1 text-[1rem] font-black tabular-nums text-on-surface">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="border-b border-on-surface/6 px-4 py-3">
            <div className="space-y-2.5 rounded-[10px] bg-surface-container-low p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ui-muted" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索目录、状态或记录 ID"
                  className="w-full rounded-[9px] border border-on-surface/8 bg-white py-2.5 pl-[2.625rem] pr-4 text-[14px] text-on-surface outline-none transition-all placeholder:text-ui-muted focus:border-primary/30 focus:ring-4 focus:ring-primary/5"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {[
                  { id: "all", label: "全部" },
                  { id: "active", label: "进行中" },
                  { id: "completed", label: "已完成" },
                  { id: "rolled_back", label: "已回退" },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setFilter(item.id as HistoryFilter)}
                    className={cn(
                      "rounded-[8px] border px-3 py-1.5 text-[12px] font-semibold transition-all",
                      filter === item.id
                        ? "border-primary bg-primary text-white"
                        : "border-on-surface/8 bg-white text-ui-muted hover:border-primary/15 hover:text-on-surface",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error ? (
            <div className="px-4 py-3">
              <ErrorAlert title="历史操作失败" message={error} />
            </div>
          ) : null}

          <div className="flex-1 overflow-y-auto px-4 py-4 scrollbar-thin">
            {loading ? (
              <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-[12px] border border-on-surface/6 bg-white text-primary">
                  <Activity className="h-6 w-6 animate-spin" />
                </div>
                <p className="text-ui-body font-medium text-ui-muted">正在载入历史记录...</p>
              </div>
            ) : filteredHistory.length > 0 ? (
              <div className="space-y-2.5">
                {filteredHistory.map((entry, idx) => {
                  const active = selectedSessionId === entry.execution_id;
                  const sessionLike = isSessionEntry(entry);

                  return (
                    <motion.div
                      key={entry.execution_id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.03 }}
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
                        "group relative overflow-hidden rounded-[10px] border transition-all cursor-pointer",
                        active
                          ? "border-primary/22 bg-primary/[0.045] shadow-[inset_0_0_0_1px_rgba(76,98,88,0.08),0_6px_16px_rgba(37,45,40,0.05)]"
                          : "border-on-surface/6 bg-white hover:border-primary/15 hover:bg-surface-container-lowest",
                      )}
                    >
                      <div className={cn("absolute inset-y-3 left-0 w-[2px] rounded-full transition-colors", active ? "bg-primary/80" : "bg-transparent")} />
                      <div className={cn("pointer-events-none absolute inset-x-0 top-0 h-12 transition-opacity", active ? "bg-primary/[0.035] opacity-100" : "opacity-0")} />

                      <div className="relative space-y-2.5 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={cn(
                                "inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-0.5 text-[12px] font-semibold",
                                sessionLike
                                  ? active
                                    ? "border-primary/20 bg-white/80 text-primary"
                                    : "border-primary/15 bg-primary/10 text-primary"
                                  : entry.status === "rolled_back"
                                    ? "border-on-surface/8 bg-surface-container-high text-on-surface/70"
                                    : "border-emerald-500/15 bg-emerald-500/10 text-emerald-700",
                              )}>
                                <span className={cn(
                                  "h-1.5 w-1.5 rounded-full",
                                  sessionLike ? "bg-primary" : entry.status === "rolled_back" ? "bg-on-surface/45" : "bg-emerald-600",
                                )} />
                                {sessionLike ? "进行中会话" : entry.status === "rolled_back" ? "已回退" : "执行结果"}
                              </span>
                              <span className="text-ui-meta text-ui-muted">{formatDisplayDate(entry.created_at)}</span>
                            </div>
                            <h3 className="line-clamp-1 text-[14px] font-semibold tracking-tight text-on-surface">
                              {getEntryName(entry)}
                            </h3>
                            <p className="line-clamp-1 text-ui-meta text-ui-muted" title={entry.target_dir}>
                              {formatPath(entry.target_dir)}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setPendingDeleteId(entry.execution_id);
                            }}
                            className={cn(
                              "rounded-[8px] border p-1.5 text-ui-muted transition-colors hover:border-error/20 hover:text-error",
                              active ? "border-on-surface/8 bg-white/85" : "border-on-surface/8 bg-white",
                            )}
                            title="删除记录"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        <div className="flex items-center justify-between gap-3 text-[12px]">
                          <div className="min-w-0">
                            <span className="text-ui-muted">当前状态</span>
                            <span className="ml-2 font-semibold text-on-surface">{getEntrySummary(entry)}</span>
                          </div>
                          <div className={cn(
                            "rounded-[8px] px-2.5 py-1 font-semibold",
                            active ? "bg-white/80 text-on-surface-variant" : "bg-on-surface/4 text-ui-muted",
                          )}>
                            {entry.item_count || 0} 项
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-full min-h-[16rem] flex-col items-center justify-center rounded-[10px] border border-dashed border-on-surface/10 bg-white px-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-[10px] bg-surface-container-low text-primary/50">
                  <HistoryIcon className="h-8 w-8" />
                </div>
                <h3 className="mt-5 text-[1.2rem] font-black font-headline tracking-tight text-on-surface">
                  {history.length === 0 ? "还没有整理记录" : "没有匹配的记录"}
                </h3>
                <p className="mt-2 text-ui-body text-ui-muted">
                  {history.length === 0
                    ? "完成一次整理后，执行结果、回退记录和未完成会话都会显示在这里。"
                    : "试试换个关键词，或者切换筛选条件。"}
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-on-surface/6 bg-surface-container-lowest">
          <AnimatePresence mode="wait">
            {selectedSessionId && selectedEntry && (isSelectedSession ? sessionDetail : journal) ? (
              <motion.div
                key={selectedSessionId}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex min-h-0 flex-1 flex-col"
              >
                <div className="border-b border-on-surface/6 bg-surface-container-lowest px-5 py-4 lg:px-6">
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
                    <div className="space-y-1.5">
                      <div className="inline-flex items-center gap-2 text-ui-meta font-medium text-ui-muted">
                        <FileClock className="h-3.5 w-3.5" />
                        {isSelectedSession ? "会话详情" : "执行详情"}
                      </div>
                      <h2 className="text-[1.25rem] font-black font-headline tracking-tight text-on-surface lg:text-[1.45rem]">
                        {getEntryName(selectedEntry)}
                      </h2>
                      <p className="max-w-3xl text-[14px] leading-6 text-ui-muted">
                        {selectedEntry.target_dir}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <div className={cn(
                        "inline-flex items-center gap-2 rounded-[9px] border px-3.5 py-2 text-[13px] font-semibold",
                        isSelectedSession
                          ? "border-primary/15 bg-primary/10 text-primary"
                          : journal?.status === "rolled_back"
                            ? "border-on-surface/8 bg-surface-container-high text-on-surface/70"
                            : "border-emerald-500/15 bg-emerald-500/10 text-emerald-700",
                      )}>
                        <span className={cn(
                          "h-2 w-2 rounded-full",
                          isSelectedSession ? "bg-primary" : journal?.status === "rolled_back" ? "bg-on-surface/45" : "bg-emerald-600",
                        )} />
                        {isSelectedSession ? getFriendlyStage(sessionDetail?.stage) : journal?.status === "rolled_back" ? "回退完成" : "执行结果"}
                      </div>

                      {!isSelectedSession && journal?.status === "completed" ? (
                        <div className="inline-flex items-center gap-2 rounded-[9px] border border-warning/15 bg-warning-container/25 px-3.5 py-2 text-[13px] font-semibold text-warning">
                          <ShieldCheck className="h-4 w-4" />
                          可以回退
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto bg-surface-container-low px-4 py-4 scrollbar-thin lg:px-5 lg:py-5">
                  {journalLoading ? (
                    <div className="flex min-h-[20rem] flex-col items-center justify-center gap-4">
                      <div className="flex h-14 w-14 items-center justify-center rounded-[12px] border border-on-surface/6 bg-white text-primary">
                        <Activity className="h-6 w-6 animate-spin" />
                      </div>
                      <p className="text-ui-body text-ui-muted">正在载入详细内容...</p>
                    </div>
                  ) : isSelectedSession ? (
                    <div className="space-y-3">
                      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(260px,0.85fr)]">
                        <div className="rounded-[10px] border border-on-surface/6 bg-white p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <p className="text-ui-meta text-ui-muted">当前阶段</p>
                              <h3 className="mt-2.5 text-[1.55rem] font-black font-headline tracking-tight text-on-surface">
                                {getFriendlyStage(sessionDetail?.stage)}
                              </h3>
                            </div>
                            <div className="rounded-[8px] bg-surface-container-low p-2.5 text-primary">
                              <FolderOpen className="h-6 w-6" />
                            </div>
                          </div>
                          <p className="mt-4 max-w-2xl text-ui-body text-ui-muted">
                            {sessionDetail?.summary || "这是一条未完成的整理记录，你可以重新进入工作台继续调整。"}
                          </p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                          <div className="rounded-[10px] border border-on-surface/6 bg-white p-4">
                            <p className="text-ui-meta text-ui-muted">最近更新时间</p>
                            <p className="mt-2.5 text-[1.25rem] font-black tracking-tight text-on-surface">
                              {formatDisplayDate(sessionDetail?.updated_at || selectedEntry.created_at)}
                            </p>
                          </div>
                          <div className="rounded-[10px] border border-on-surface/6 bg-white p-4">
                            <p className="text-ui-meta text-ui-muted">计划条目</p>
                            <p className="mt-2.5 text-[1.25rem] font-black tracking-tight text-on-surface">
                              {sessionDetail?.plan_snapshot?.stats?.move_count || 0}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-[10px] border border-on-surface/6 bg-white p-4">
                        <div className="space-y-4">
                          <div>
                            <p className="text-ui-meta text-ui-muted">状态说明</p>
                            <p className="mt-2.5 text-ui-body text-on-surface">
                              {sessionDetail?.summary || "这是一条未完成的整理记录，可以重新进入工作台继续处理。"}
                            </p>
                          </div>

                          {sessionDetail?.last_error ? (
                            <div className="rounded-[9px] border border-warning/15 bg-warning-container/15 px-4 py-3 text-[13px] font-semibold leading-relaxed text-warning">
                              最近错误：{sessionDetail.last_error}
                            </div>
                          ) : null}

                          <div className="flex flex-wrap gap-3">
                            <Button variant="primary" onClick={() => handleOpenSession(false)} className="px-7 py-3">
                              <PlayCircle className="h-4 w-4" />
                              继续整理
                            </Button>
                            <Button variant="secondary" onClick={() => handleOpenSession(true)} className="px-7 py-3">
                              <Eye className="h-4 w-4" />
                              只读查看
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {rollbackSuccess ? (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.98 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="rounded-[10px] border border-emerald-500/12 bg-white p-4"
                        >
                          <div className="flex items-start gap-4">
                            <div className="flex h-10 w-10 items-center justify-center rounded-[9px] bg-emerald-500/12 text-emerald-700">
                              <Undo2 className="h-5 w-5" />
                            </div>
                            <div>
                              <h3 className="text-[1.05rem] font-black tracking-tight text-on-surface">回退完成</h3>
                              <p className="mt-2 text-ui-body text-ui-muted">
                                这次移动过的内容已经按原路径放回，受影响的 {journal?.item_count || 0} 项内容已完成恢复。
                              </p>
                            </div>
                          </div>
                        </motion.div>
                      ) : null}

                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-[10px] border border-on-surface/6 bg-white p-4">
                          <p className="text-ui-meta text-ui-muted">处理条目</p>
                          <p className="mt-2.5 text-[1.35rem] font-black tracking-tight text-on-surface tabular-nums">
                            {journal?.item_count || 0}
                          </p>
                        </div>
                        <div className="rounded-[10px] border border-on-surface/6 bg-white p-4">
                          <p className="text-ui-meta text-ui-muted">成功项目</p>
                          <p className="mt-2.5 text-[1.35rem] font-black tracking-tight text-on-surface tabular-nums">
                            {journal?.success_count || 0}
                          </p>
                        </div>
                        <div className="rounded-[10px] border border-on-surface/6 bg-white p-4">
                          <p className="text-ui-meta text-ui-muted">失败项目</p>
                          <p className="mt-2.5 text-[1.35rem] font-black tracking-tight text-on-surface tabular-nums">
                            {journal?.failure_count || 0}
                          </p>
                        </div>
                      </div>

                      <div className="rounded-[10px] border border-on-surface/6 bg-white p-4">
                        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                          <div>
                            <p className="text-ui-meta text-ui-muted">路径变化记录</p>
                            <h3 className="mt-2 text-[1.2rem] font-black font-headline tracking-tight text-on-surface">
                              这次整理具体改了什么
                            </h3>
                            <p className="mt-1.5 text-ui-body text-ui-muted">
                              左侧是当前路径，右侧是原始位置。回退后则显示恢复关系。
                            </p>
                          </div>

                          {!rollbackSuccess && journal?.status === "completed" ? (
                            <Button
                              variant="danger"
                              onClick={() => setRollbackConfirmOpen(true)}
                              disabled={actionLoading}
                              loading={actionLoading}
                              className="px-7 py-3"
                            >
                              <Undo2 className="h-4 w-4" />
                              回退这次整理
                            </Button>
                          ) : null}
                        </div>

                        <div className="mt-5 overflow-hidden rounded-[10px] border border-on-surface/6">
                          <table className="w-full border-collapse text-left">
                            <thead className="bg-surface-container-low/55">
                              <tr className="text-ui-meta font-semibold text-ui-muted">
                                <th className="px-4 py-3.5">文件</th>
                                <th className="px-4 py-3.5">路径变化</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-on-surface/6 bg-white">
                              {moveRows.length ? (
                                moveRows.map((item, index) => (
                                  <tr key={index} className="transition-colors hover:bg-surface-container-low/28">
                                    <td className="px-4 py-3.5 align-top">
                                      <p className="max-w-[18rem] truncate text-[14px] font-semibold text-on-surface" title={item.display_name}>
                                        {item.display_name}
                                      </p>
                                    </td>
                                    <td className="px-4 py-3.5">
                                      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 text-[13px]">
                                        <span className="truncate text-right font-mono text-ui-muted" title={item.target || ""}>
                                          {formatMovePath(item.target, journal?.target_dir || "")}
                                        </span>
                                        <ArrowRight className="h-3.5 w-3.5 text-primary/55" />
                                        <span className="truncate font-mono font-semibold text-primary" title={item.source || ""}>
                                          {formatMovePath(item.source, journal?.target_dir || "")}
                                        </span>
                                      </div>
                                    </td>
                                  </tr>
                                ))
                              ) : (
                                <tr>
                                  <td colSpan={2} className="px-4 py-12 text-center text-ui-body text-ui-muted">
                                    暂时没有可显示的路径变化记录。
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            ) : (
              <div className="flex h-full min-h-[24rem] flex-col items-center justify-center px-8 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-[10px] bg-white text-primary/45 border border-on-surface/6">
                  <HistoryIcon className="h-8 w-8" />
                </div>
                <h3 className="mt-6 text-[1.35rem] font-black font-headline tracking-tight text-on-surface">
                  选择一条记录开始查看
                </h3>
                <p className="mt-3 max-w-lg text-ui-body text-ui-muted">
                  你可以在左侧搜索目录、筛选状态，或者直接打开某条会话与执行结果继续处理。
                </p>
              </div>
            )}
          </AnimatePresence>
        </section>
      </div>

      <ConfirmDialog
        open={rollbackConfirmOpen}
        title="确认回退这次整理？"
        description="这会把本次整理已移动的文件尽量放回原位置。若目标文件已被占用或发生冲突，部分回退可能失败。"
        confirmLabel="确认回退"
        cancelLabel="先不回退"
        tone="danger"
        loading={actionLoading}
        onConfirm={handleRollback}
        onCancel={() => setRollbackConfirmOpen(false)}
      />
      <ConfirmDialog
        open={Boolean(pendingDeleteId)}
        title="删除这条历史记录？"
        description="删除后，这条会话或执行记录将不会再出现在历史列表中，操作无法撤销。"
        confirmLabel="确认删除"
        cancelLabel="取消"
        tone="danger"
        loading={actionLoading}
        onConfirm={handleDeleteHistory}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
}
