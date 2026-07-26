"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createApiClient } from "@/lib/api";
import { getApiBaseUrl, getApiToken } from "@/lib/runtime";
import { localizeUserFacingError } from "@/lib/user-facing-copy";
import { getFriendlyStage, getFriendlyStatus } from "@/lib/utils";
import { getWorkspaceRouteForHistoryEntry } from "@/lib/workspace-routes";
import type { HistoryItem } from "@/types/session";

export type HistoryFilter = "all" | "active" | "completed" | "partial_failure" | "rolled_back" | "rollback_partial_failure";

const APP_CONTEXT_EVENT = "file-pilot-context-change";
const ACTIVE_WORKSPACE_ROUTE_KEY = "workspace_active_route";
const SUCCESS_EXECUTION_STATUSES = new Set(["success", "completed"]);
const FAILED_EXECUTION_STATUSES = new Set(["partial_failure"]);
const ROLLED_BACK_EXECUTION_STATUSES = new Set(["rolled_back"]);
const FAILED_ROLLBACK_STATUSES = new Set(["rollback_partial_failure"]);
const FINAL_EXECUTION_STATUSES = new Set([
  ...SUCCESS_EXECUTION_STATUSES,
  ...FAILED_EXECUTION_STATUSES,
  ...ROLLED_BACK_EXECUTION_STATUSES,
  ...FAILED_ROLLBACK_STATUSES,
]);
const SEARCH_DEBOUNCE_MS = 200;
const historyDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function normalizedHistoryStatus(entry: HistoryItem): string {
  return String(entry.status || "").trim().toLowerCase();
}

export function isHistorySessionEntry(entry: HistoryItem): boolean {
  return Boolean(entry.is_session) || !FINAL_EXECUTION_STATUSES.has(normalizedHistoryStatus(entry));
}

export function isHistoryExecutionEntry(entry: HistoryItem): boolean {
  return !isHistorySessionEntry(entry);
}

export function isHistoryCompletedEntry(entry: HistoryItem): boolean {
  return isHistoryExecutionEntry(entry) && SUCCESS_EXECUTION_STATUSES.has(normalizedHistoryStatus(entry));
}

export function isHistoryPartialFailureEntry(entry: HistoryItem): boolean {
  return isHistoryExecutionEntry(entry) && FAILED_EXECUTION_STATUSES.has(normalizedHistoryStatus(entry));
}

export function isHistoryRolledBackEntry(entry: HistoryItem): boolean {
  return isHistoryExecutionEntry(entry) && ROLLED_BACK_EXECUTION_STATUSES.has(normalizedHistoryStatus(entry));
}

export function isHistoryRollbackPartialFailureEntry(entry: HistoryItem): boolean {
  return isHistoryExecutionEntry(entry) && FAILED_ROLLBACK_STATUSES.has(normalizedHistoryStatus(entry));
}

export function getHistoryEntrySummary(entry: HistoryItem): string {
  return isHistorySessionEntry(entry) ? getFriendlyStage(entry.status) : getFriendlyStatus(entry.status);
}

export function getHistoryEntryHref(entry: HistoryItem): string {
  if (!isHistorySessionEntry(entry)) {
    return `/history?entry_id=${entry.execution_id}`;
  }
  return getWorkspaceRouteForHistoryEntry({
    sessionId: entry.execution_id,
    targetDir: entry.target_dir,
    status: entry.status,
    itemCount: entry.item_count,
  });
}

export function getHistoryEntryReadonlyHref(entry: HistoryItem): string {
  if (!isHistorySessionEntry(entry)) {
    return `/history?entry_id=${entry.execution_id}`;
  }
  return getWorkspaceRouteForHistoryEntry({
    sessionId: entry.execution_id,
    targetDir: entry.target_dir,
    status: entry.status,
    itemCount: entry.item_count,
    readonly: true,
  });
}

export function getSessionIdFromWorkspaceRoute(route: string | null): string | null {
  if (!route?.startsWith("/workspace")) {
    return null;
  }
  const query = route.split("?")[1] || "";
  return new URLSearchParams(query).get("session_id");
}

export function clearActiveWorkspaceRouteForSession(sessionId: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const storedRoute = window.localStorage.getItem(ACTIVE_WORKSPACE_ROUTE_KEY);
  if (getSessionIdFromWorkspaceRoute(storedRoute) !== sessionId) {
    return false;
  }
  window.localStorage.removeItem(ACTIVE_WORKSPACE_ROUTE_KEY);
  window.dispatchEvent(new Event(APP_CONTEXT_EVENT));
  return true;
}

export function getHistoryDeletePrompt(entry: HistoryItem | null): { title: string; description: string } {
  if (entry && isHistorySessionEntry(entry)) {
    return {
      title: "删除这个任务？",
      description: "这是一个未完成任务。删除后将无法从工作区继续它，当前任务入口也会同步清除，操作无法撤销。",
    };
  }
  return {
    title: "删除这条历史记录？",
    description: "删除后，这条执行记录将不会再出现在历史列表中，操作无法撤销。",
  };
}

function getHistoryEntryFallbackName(entry: HistoryItem): string {
  return entry.target_dir.replace(/[\\/]$/, "").split(/[\\/]/).pop() || "未命名记录";
}

export function getHistoryEntryName(entry: HistoryItem): string {
  const date = new Date(entry.created_at);
  if (Number.isNaN(date.getTime())) {
    return getHistoryEntryFallbackName(entry);
  }
  return historyDateFormatter.format(date);
}

function filterHistoryEntries(history: HistoryItem[], query: string, filter: HistoryFilter) {
  const keyword = query.trim().toLowerCase();

  return history.filter((entry) => {
    const isSession = isHistorySessionEntry(entry);
    const matchesFilter =
      filter === "all"
        ? true
        : filter === "active"
          ? isSession
          : filter === "completed"
            ? isHistoryCompletedEntry(entry)
            : filter === "partial_failure"
              ? isHistoryPartialFailureEntry(entry)
              : filter === "rolled_back"
                ? isHistoryRolledBackEntry(entry)
                : isHistoryRollbackPartialFailureEntry(entry);

    if (!matchesFilter) {
      return false;
    }

    if (!keyword) {
      return true;
    }

    const name = getHistoryEntryName(entry);
    return [entry.target_dir, name, entry.status].some((value) =>
      value.toLowerCase().includes(keyword),
    );
  });
}

function toErrorMessage(error: unknown, fallback: string) {
  return localizeUserFacingError(error, fallback);
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

export function useHistoryList({ autoLoad = true }: { autoLoad?: boolean } = {}) {
  const api = useMemo(() => createApiClient(getApiBaseUrl(), getApiToken()), []);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(autoLoad);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getHistory();
      setHistory(data);
      return data;
    } catch (err) {
      setError(toErrorMessage(err, "读取历史记录失败"));
      return null;
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    if (autoLoad) {
      void loadHistory();
    }
  }, [autoLoad, loadHistory]);

  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);

  const filteredHistory = useMemo(
    () => filterHistoryEntries(history, debouncedQuery, filter),
    [debouncedQuery, filter, history],
  );

  const requestDelete = useCallback((id: string) => {
    setPendingDeleteId(id);
  }, []);

  const cancelDelete = useCallback(() => {
    setPendingDeleteId(null);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!pendingDeleteId) {
      return null;
    }

    setDeletingId(pendingDeleteId);
    setError(null);
    try {
      await api.deleteHistoryEntry(pendingDeleteId);
      const deletedId = pendingDeleteId;
      setHistory((prev) => prev.filter((entry) => entry.execution_id !== deletedId));
      setPendingDeleteId(null);
      return deletedId;
    } catch (err) {
      setError(toErrorMessage(err, "删除记录时发生错误"));
      return null;
    } finally {
      setDeletingId(null);
    }
  }, [api, pendingDeleteId]);

  return {
    api,
    history,
    setHistory,
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
  };
}
