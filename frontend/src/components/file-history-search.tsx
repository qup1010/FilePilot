"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileSearch, FolderOpen, Loader2, TriangleAlert } from "lucide-react";

import type { ApiClient } from "@/lib/api";
import { getPathBasename } from "@/lib/path-normalization";
import { cn, formatDisplayDate } from "@/lib/utils";
import type { FileHistoryMatch } from "@/types/session";

const SEARCH_DEBOUNCE_MS = 300;

const STATUS_COPY: Record<string, { label: string; className: string }> = {
  success: { label: "已归位", className: "bg-primary/10 text-primary" },
  rolled_back: { label: "已回退", className: "bg-on-surface/8 text-on-surface-variant" },
  skipped: { label: "跳过未动", className: "bg-amber-500/10 text-amber-600" },
  failed: { label: "移动失败", className: "bg-error/10 text-error" },
  pending: { label: "去向待核实", className: "bg-error/10 text-error" },
};

function parentDirectory(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : normalized;
}

interface FileHistorySearchProps {
  api: Pick<ApiClient, "searchFileHistory" | "openDir">;
  onSelectExecution: (executionId: string) => void;
}

export function FileHistorySearch({ api, onSelectExecution }: FileHistorySearchProps) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<FileHistoryMatch[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const trimmedQuery = query.trim();

  useEffect(() => {
    if (!trimmedQuery) {
      setMatches([]);
      setTotal(0);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    const seq = ++requestSeq.current;
    const timer = setTimeout(async () => {
      try {
        const result = await api.searchFileHistory(trimmedQuery, 30);
        if (seq !== requestSeq.current) return;
        setMatches(result.matches);
        setTotal(result.total);
        setError(null);
      } catch {
        if (seq !== requestSeq.current) return;
        setError("查找文件去向失败，请稍后重试。");
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [api, trimmedQuery]);

  const hasResults = useMemo(() => trimmedQuery.length > 0, [trimmedQuery]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <FileSearch className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ui-muted opacity-50" />
        {loading ? (
          <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-primary" />
        ) : null}
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="找文件：输入文件名片段，查它现在在哪..."
          className="w-full rounded-[6px] border border-on-surface/10 bg-on-surface/[0.02] py-2 pl-[2.25rem] pr-9 text-[13px] font-medium text-on-surface outline-none transition-all placeholder:text-ui-muted/50 focus:bg-surface focus:ring-2 focus:ring-primary/5"
        />
      </div>

      {hasResults ? (
        <div className="max-h-[280px] overflow-y-auto rounded-[8px] border border-on-surface/8 bg-surface scrollbar-thin">
          {error ? (
            <div className="flex items-center gap-2 px-3 py-3 text-[12px] font-semibold text-error">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {error}
            </div>
          ) : matches.length === 0 && !loading ? (
            <p className="px-3 py-3 text-[12px] font-semibold text-on-surface-variant/60">
              整理记录中没有匹配「{trimmedQuery}」的文件。
            </p>
          ) : (
            <ul>
              {matches.map((match, index) => {
                const status = STATUS_COPY[match.status] || { label: match.status, className: "bg-on-surface/8 text-on-surface-variant" };
                const currentPath = match.current_path || "";
                return (
                  <li
                    key={`${match.execution_id}-${index}`}
                    className={cn("px-3 py-2", index > 0 && "border-t border-on-surface/6")}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[12px] font-bold text-on-surface" title={match.display_name}>
                        {match.display_name}
                      </span>
                      <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold", status.className)}>
                        {status.label}
                      </span>
                      {currentPath && !match.current_path_exists ? (
                        <span className="shrink-0 rounded-full bg-error/10 px-1.5 py-0.5 text-[10px] font-bold text-error" title="记录位置上已不存在，可能又被移动或删除">
                          原处已不在
                        </span>
                      ) : null}
                      <span className="ml-auto shrink-0 text-[10px] font-semibold tabular-nums text-on-surface-variant/50">
                        {formatDisplayDate(match.moved_at)}
                      </span>
                    </div>
                    {currentPath ? (
                      <p className="mt-0.5 truncate font-mono text-[11px] text-on-surface-variant/60" title={currentPath}>
                        {currentPath}
                      </p>
                    ) : null}
                    <div className="mt-1 flex items-center gap-2">
                      {currentPath ? (
                        <button
                          type="button"
                          onClick={() => void api.openDir(parentDirectory(currentPath))}
                          className="flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[11px] font-bold text-primary transition-colors hover:bg-primary/10"
                        >
                          <FolderOpen className="h-3 w-3" aria-hidden />
                          打开所在文件夹
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => onSelectExecution(match.execution_id)}
                        className="rounded-[6px] px-1.5 py-0.5 text-[11px] font-bold text-on-surface-variant transition-colors hover:bg-on-surface/5 hover:text-on-surface"
                      >
                        查看该次整理
                      </button>
                      {match.target_dir ? (
                        <span className="ml-auto truncate text-[10px] text-on-surface-variant/40" title={match.target_dir}>
                          来自 {getPathBasename(match.target_dir, match.target_dir)}
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
              {total > matches.length ? (
                <li className="border-t border-on-surface/6 px-3 py-1.5 text-[11px] font-semibold text-on-surface-variant/50">
                  共 {total} 条匹配，仅显示最近 {matches.length} 条，请输入更具体的文件名。
                </li>
              ) : null}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
