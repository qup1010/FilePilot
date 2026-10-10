"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  RotateCcw,
  Info
} from "lucide-react";
import type { RollbackPrecheckSummary } from "@/types/session";
import { motion } from "motion/react";
import { PathDiffViewer } from "./path-diff-viewer";
import { useTranslation } from "react-i18next";

interface RollbackPreviewDialogProps {
  open: boolean;
  precheck: RollbackPrecheckSummary | null;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RollbackPreviewDialog({
  open,
  precheck,
  loading,
  onConfirm,
  onCancel,
}: RollbackPreviewDialogProps) {
  const { t } = useTranslation("common");
  const canExecute = precheck?.can_execute ?? false;
  const actions = precheck?.actions ?? [];
  const errors = precheck?.blocking_errors ?? [];
  const itemSkips = precheck?.item_skips ?? [];
  const restorableCount = Math.max(0, actions.length - itemSkips.length);

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onCancel()}>
      <DialogContent className="max-w-2xl gap-0 p-0 overflow-hidden border border-on-surface/10 bg-surface shadow-[0_12px_40px_rgba(0,0,0,0.12)]">
        <DialogHeader className="p-6 border-b border-on-surface/5 bg-on-surface/[0.01]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-warning/10 text-warning">
              <RotateCcw className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-[16px] font-black tracking-tight">{t("workspace.rollback.confirmTitle")}</DialogTitle>
              <DialogDescription className="text-[12px] font-medium opacity-50">
                {t("workspace.rollback.confirmDescription")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[400px] overflow-y-auto p-0 scrollbar-thin">
          {!precheck ? (
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2 px-2 text-[11px] font-bold text-primary">
                <div className="h-3.5 w-3.5 animate-spin border-2 border-primary border-t-transparent rounded-full" />
                <span>{t("workspace.rollback.checking")}</span>
              </div>
              {[1, 2, 3].map((idx) => (
                <div key={idx} className="flex flex-col gap-2 rounded-xl border border-on-surface/5 bg-on-surface/[0.015] p-3.5 animate-pulse">
                  <div className="flex items-center justify-between">
                    <div className="h-4 w-40 rounded bg-on-surface/8" />
                    <div className="h-4 w-16 rounded bg-on-surface/6" />
                  </div>
                  <div className="h-3 w-3/4 rounded bg-on-surface/5" />
                </div>
              ))}
            </div>
          ) : (
            <div className="divide-y divide-on-surface/5">
              {/* Actions List */}
              <div className="p-4 space-y-2 bg-on-surface/[0.01]">
                <h4 className="px-2 text-[11px] font-black uppercase tracking-widest text-ui-muted/40 mb-3">{t("workspace.rollback.actionsTitle", { count: actions.length })}</h4>
                {actions.map((action, idx) => (
                  <motion.div 
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    key={idx} 
                    className="group flex flex-col gap-1.5 rounded-md border border-on-surface/5 bg-surface p-3 transition-colors hover:bg-on-surface/[0.02]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-[12px] font-black text-on-surface/80">{action.display_name}</span>
                      <span className="shrink-0 rounded-[4px] bg-primary/10 px-1.5 py-0.5 text-[11px] font-black tracking-wider text-primary">
                        {action.restore_kind === "from_review"
                          ? t("workspace.rollback.restoreFromReview")
                          : action.type === "MOVE" ? t("workspace.rollback.moveAction") : action.type}
                      </span>
                    </div>
                    <div className="mt-2 border-t border-on-surface/5 pt-2">
                      <PathDiffViewer
                        source={action.source}
                        target={action.target}
                        compact={true}
                        targetKind={action.target_kind}
                        isReview={action.is_review}
                      />
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* 无法还原的项：逐项呈现原因，其余项照常还原 */}
              {itemSkips.length > 0 && (
                <div className="p-5 bg-warning/[0.02]">
                  <div className="flex items-center gap-2 text-warning-dim mb-3">
                    <Info className="h-4 w-4" />
                    <h4 className="text-[12px] font-black tracking-tight">{t("workspace.rollback.skipTitle")}</h4>
                    <span className="font-mono text-[11px] font-bold text-warning-dim/60">{t("workspace.rollback.itemCount", { count: itemSkips.length })}</span>
                  </div>
                  <ul className="space-y-1.5">
                    {itemSkips.map((skip, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-[11px] font-medium text-on-surface-variant/80 leading-relaxed">
                        <div className="mt-1 h-1 w-1 shrink-0 rounded-full bg-warning/50" />
                        <span>
                          {skip.display_name ? <span className="font-black text-on-surface/80">{skip.display_name}：</span> : null}
                          {skip.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Errors & Warnings */}
              {(errors.length > 0 || !canExecute) && (
                <div className="p-5 bg-error/[0.02]">
                  <div className="flex items-center gap-2 text-error mb-3">
                    <XCircle className="h-4 w-4" />
                    <h4 className="text-[12px] font-black tracking-tight">
                      {errors.length > 0
                        ? t("workspace.rollback.blockedByConflict")
                        : t("workspace.rollback.noRestorableItems")}
                    </h4>
                  </div>
                  {errors.length > 0 ? (
                    <ul className="space-y-1.5">
                      {errors.map((err, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-[11px] font-medium text-error/80 leading-relaxed">
                          <div className="mt-1 h-1 w-1 shrink-0 rounded-full bg-error/40" />
                          {err}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-4 rounded-md border border-error/10 bg-error/5 p-3 flex gap-3">
                    <Info className="h-4 w-4 text-error shrink-0 mt-0.5" />
                    <p className="text-[11px] font-medium text-error/70 leading-relaxed">
                      {errors.length > 0
                        ? t("workspace.rollback.conflictHelp")
                        : t("workspace.rollback.nothingToRestoreHelp")}
                    </p>
                  </div>
                </div>
              )}

              {canExecute && errors.length === 0 && (
                <div className="p-5 bg-success/[0.02]">
                  <div className="flex items-center gap-2 text-success-dim">
                    <CheckCircle2 className="h-4 w-4" />
                    <h4 className="text-[12px] font-black tracking-tight">
                      {itemSkips.length > 0
                        ? t("workspace.rollback.readyWithSkips", { restorable: restorableCount, skipped: itemSkips.length })
                        : t("workspace.rollback.ready")}
                    </h4>
                  </div>
                  <p className="mt-2 text-[11px] font-medium text-ui-muted/60 leading-relaxed">
                    {itemSkips.length > 0
                      ? t("workspace.rollback.readyWithSkipsDescription")
                      : t("workspace.rollback.readyDescription")}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="p-4 border-t border-on-surface/5 bg-on-surface/[0.02] sm:justify-between sm:items-center">
          <div className="hidden sm:flex items-center gap-2 text-[11px] font-medium text-ui-muted/40">
            <AlertTriangle className="h-3 w-3" />
            {t("workspace.rollback.footerWarning")}
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              onClick={onCancel}
              disabled={loading}
              className="h-9 rounded-[8px] px-5 text-[12px] font-bold text-on-surface/60 hover:bg-on-surface/5"
            >
              {t("workspace.rollback.cancel")}
            </Button>
            <Button
              variant="danger"
              onClick={onConfirm}
              disabled={loading || !canExecute}
              loading={loading}
              className="h-9 rounded-[8px] px-8 text-[12px] font-black"
            >
              {t("workspace.rollback.confirm")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function _formatPath(path: string): string {
  if (!path) return "";
  const parts = path.split(/[\\/]/);
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-3).join("/")}`;
}
