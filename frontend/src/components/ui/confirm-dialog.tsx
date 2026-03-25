"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Info } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  tone = "primary",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const isDanger = tone === "danger";

  return (
    <AnimatePresence>
      {open ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-surface/70 p-6 backdrop-blur-md"
          onClick={() => {
            if (!loading) {
              onCancel();
            }
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="w-full max-w-2xl rounded-xl border border-on-surface/8 bg-white p-8 shadow-[0_24px_80px_rgba(36,48,42,0.18)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-5">
              <div
                className={cn(
                  "flex h-12 w-12 shrink-0 items-center justify-center rounded-md border",
                  isDanger
                    ? "border-error/12 bg-error-container/20 text-error"
                    : "border-primary/12 bg-primary/10 text-primary",
                )}
              >
                {isDanger ? <AlertTriangle className="h-5 w-5" /> : <Info className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <h2 className="text-2xl font-black tracking-tight text-on-surface">{title}</h2>
                <p className="text-[15px] leading-8 text-on-surface-variant">{description}</p>
              </div>
            </div>

            <div className="mt-8 flex justify-end gap-3">
              <Button variant="secondary" onClick={onCancel} disabled={loading} className="px-8 py-3.5">
                {cancelLabel}
              </Button>
              <Button
                variant={isDanger ? "danger" : "primary"}
                onClick={() => void onConfirm()}
                loading={loading}
                className="px-8 py-3.5"
              >
                {confirmLabel}
              </Button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
