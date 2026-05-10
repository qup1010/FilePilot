"use client";

import React from "react";
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
  ArrowRight, 
  CheckCircle2, 
  XCircle, 
  RotateCcw,
  Info
} from "lucide-react";
import type { RollbackPrecheckSummary } from "@/types/session";
import { motion } from "framer-motion";

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
  const canExecute = precheck?.can_execute ?? false;
  const actions = precheck?.actions ?? [];
  const errors = precheck?.blocking_errors ?? [];

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onCancel()}>
      <DialogContent className="max-w-2xl gap-0 p-0 overflow-hidden border-on-surface/10 bg-surface shadow-2xl">
        <DialogHeader className="p-6 border-b border-on-surface/5 bg-on-surface/[0.01]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-warning/10 text-warning">
              <RotateCcw className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-[16px] font-black tracking-tight">确认回退执行</DialogTitle>
              <DialogDescription className="text-[12px] font-medium opacity-50">
                预览即将执行的回退操作，系统将尝试撤销本次整理的所有变动。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[400px] overflow-y-auto p-0 scrollbar-thin">
          {!precheck ? (
            <div className="flex flex-col items-center justify-center py-12 opacity-30">
              <div className="h-6 w-6 animate-spin border-2 border-primary border-t-transparent rounded-full" />
              <p className="mt-3 text-[11px] font-bold uppercase tracking-widest">正在加载预检信息...</p>
            </div>
          ) : (
            <div className="divide-y divide-on-surface/5">
              {/* Actions List */}
              <div className="p-4 space-y-2 bg-on-surface/[0.01]">
                <h4 className="px-2 text-[10px] font-black uppercase tracking-widest text-ui-muted/40 mb-3">待撤销的变更项 ({actions.length})</h4>
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
                      <span className="shrink-0 rounded-[4px] bg-primary/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-primary">
                        {action.type}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] font-medium text-ui-muted/50">
                      <span className="truncate max-w-[200px]" title={action.source}>{formatPath(action.source)}</span>
                      <ArrowRight className="h-3 w-3 shrink-0 opacity-40" />
                      <span className="truncate max-w-[200px] text-success-dim" title={action.target}>{formatPath(action.target)}</span>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Errors & Warnings */}
              {(errors.length > 0 || !canExecute) && (
                <div className="p-5 bg-error/[0.02]">
                  <div className="flex items-center gap-2 text-error mb-3">
                    <XCircle className="h-4 w-4" />
                    <h4 className="text-[12px] font-black tracking-tight">检测到阻断性冲突</h4>
                  </div>
                  <ul className="space-y-1.5">
                    {errors.map((err, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-[11px] font-medium text-error/80 leading-relaxed">
                        <div className="mt-1 h-1 w-1 shrink-0 rounded-full bg-error/40" />
                        {err}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 rounded-md border border-error/10 bg-error/5 p-3 flex gap-3">
                    <Info className="h-4 w-4 text-error shrink-0 mt-0.5" />
                    <p className="text-[11px] font-medium text-error/70 leading-relaxed">
                      上述路径冲突将导致回退失败。请先手动移除冲突的文件或检查目录权限，然后再试。
                    </p>
                  </div>
                </div>
              )}
              
              {canExecute && errors.length === 0 && (
                <div className="p-5 bg-success/[0.02]">
                  <div className="flex items-center gap-2 text-success-dim">
                    <CheckCircle2 className="h-4 w-4" />
                    <h4 className="text-[12px] font-black tracking-tight">预检通过：系统可以尝试自动回退</h4>
                  </div>
                  <p className="mt-2 text-[11px] font-medium text-ui-muted/60 leading-relaxed">
                    所有回退路径当前均可写入。点击确认后，系统将尝试将文件移回原始位置并清理本次生成的目录结构。
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="p-4 border-t border-on-surface/5 bg-on-surface/[0.02] sm:justify-between sm:items-center">
          <div className="hidden sm:flex items-center gap-2 text-[11px] font-medium text-ui-muted/40">
            <AlertTriangle className="h-3 w-3" />
            回退操作不可撤销，请仔细核对。
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              onClick={onCancel}
              disabled={loading}
              className="h-9 rounded-[8px] px-5 text-[12px] font-bold text-on-surface/60 hover:bg-on-surface/5"
            >
              取消
            </Button>
            <Button
              variant="danger"
              onClick={onConfirm}
              disabled={loading || !canExecute}
              loading={loading}
              className="h-9 rounded-[8px] px-8 text-[12px] font-black shadow-lg shadow-error/10"
            >
              确认回退
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatPath(path: string): string {
  if (!path) return "";
  const parts = path.split(/[\\/]/);
  if (parts.length <= 3) return path;
  return `.../${parts.slice(-3).join("/")}`;
}
