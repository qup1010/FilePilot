"use client";

import type { ReactNode } from "react";
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
  children?: ReactNode;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  onClose?: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  tone = "primary",
  loading = false,
  children,
  onConfirm,
  onCancel,
  onClose,
}: ConfirmDialogProps) {
  const isDanger = tone === "danger";

  const handleCancel = onClose || onCancel || (() => {});

  return (
    <AnimatePresence>
      {open ? (
        <div
          className="ui-dialog-backdrop fixed inset-0 z-[90] flex items-center justify-center p-6 transition-all"
          onClick={() => {
            if (!loading) {
              handleCancel();
            }
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.24, ease: "easeOut" }}
            className="ui-dialog w-full max-w-[460px] overflow-hidden"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-7 pb-5 pt-7 sm:px-8">
              <div className="flex items-start gap-4">
                <div
                  className={cn(
                    "flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] border border-on-surface/10",
                    isDanger
                      ? "bg-error-container/45 text-error"
                      : "bg-primary/10 text-primary",
                  )}
                >
                  {isDanger ? <AlertTriangle className="h-[20px] w-[20px]" /> : <Info className="h-[20px] w-[20px]" />}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <h2 className="text-[1.1rem] font-black tracking-tight text-on-surface">{title}</h2>
                  <p className="text-[13.5px] leading-6 text-ui-subtle">{description}</p>
                  {children ? <div className="pt-2">{children}</div> : null}
                </div>
              </div>
            </div>

            <div className="flex gap-3 border-t border-on-surface/6 bg-surface-container-low/45 px-6 py-4">
              <Button 
                variant="secondary" 
                onClick={handleCancel} 
                disabled={loading} 
                className="flex-1"
              >
                {cancelLabel}
              </Button>
              <Button
                variant={isDanger ? "danger" : "primary"}
                onClick={() => void onConfirm()}
                loading={loading}
                className="flex-1"
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
