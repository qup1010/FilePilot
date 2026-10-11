import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { getPathBasename } from "@/lib/path-normalization";
import { getHistoryEntrySummary, isHistorySessionEntry } from "@/lib/use-history-list";
import { cn, formatDisplayDate } from "@/lib/utils";
import type { HistoryItem } from "@/types/session";

interface LauncherHistoryPanelProps {
  entries: HistoryItem[];
  loading: boolean;
  backendUnavailable: boolean;
  onOpenHistoryPage: () => void;
  onOpenEntry: (entry: HistoryItem) => void;
}

export function LauncherHistoryPanel({
  entries,
  loading,
  backendUnavailable,
  onOpenHistoryPage,
  onOpenEntry,
}: LauncherHistoryPanelProps) {
  const { t, i18n } = useTranslation("common");
  return (
    <div className="rounded-lg border border-on-surface/8 bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-black text-on-surface uppercase tracking-tight">{t("launcher.historyPanel.title")}</h3>
        <button
          type="button"
          onClick={onOpenHistoryPage}
          className="rounded-md px-2.5 py-1 text-[11px] font-black text-primary hover:bg-primary/8 uppercase tracking-wider transition-colors"
        >
          {t("launcher.historyPanel.all")}
        </button>
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {loading ? (
          <div className="col-span-full flex items-center gap-2 py-5 text-[12px] font-black text-ui-muted/60">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            {t("launcher.historyPanel.loading")}
          </div>
        ) : entries.length ? (
          entries.map((entry) => {
            const status = String(entry.status || "").toLowerCase();
            const summary = isHistorySessionEntry(entry)
              ? t(`workspaceStage.${status}`, { defaultValue: getHistoryEntrySummary(entry) })
              : t(`historyStatus.${status}`, { defaultValue: getHistoryEntrySummary(entry) });
            const actionKey = !isHistorySessionEntry(entry)
              ? "historyAction.view"
              : status === "draft" || status === "idle"
                ? "historyAction.continueAndScan"
                : status === "interrupted" || status === "stale"
                  ? "historyAction.resume"
                  : "historyAction.continue";
            return (
              <button
                key={entry.execution_id}
                type="button"
                onClick={() => onOpenEntry(entry)}
                className="group flex w-full items-center justify-between gap-3 rounded-lg border border-on-surface/[0.04] bg-on-surface/[0.005] px-3 py-2.5 text-left transition-all hover:border-primary/10 hover:bg-on-surface/[0.02]"
              >
                <div className="min-w-0 flex-1 flex items-start gap-2.5">
                  <span className={cn(
                    "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                    isHistorySessionEntry(entry) ? "bg-primary animate-pulse" : entry.status === "partial_failure" ? "bg-warning" : "bg-success-dim",
                  )} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-black text-on-surface/85 group-hover:text-on-surface transition-colors">{getPathBasename(entry.target_dir, t("launcher.historyPanel.unnamedTask"))}</p>
                    <p className="mt-0.5 truncate text-[11px] font-medium text-ui-muted/50">
                      {summary} · {formatDisplayDate(entry.created_at, i18n.resolvedLanguage)}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 flex items-center justify-center rounded px-2 py-1 text-[11px] font-black text-primary bg-primary/5 opacity-0 translate-x-2 transition-all duration-200 group-hover:opacity-100 group-hover:translate-x-0 uppercase tracking-widest">
                  {t(actionKey)}
                </span>
              </button>
            );
          })
        ) : (
          <div className="col-span-full py-5 text-[12px] font-medium text-ui-muted/60">
            {backendUnavailable ? t("launcher.historyPanel.backendUnavailable") : t("launcher.historyPanel.empty")}
          </div>
        )}
      </div>
    </div>
  );
}
