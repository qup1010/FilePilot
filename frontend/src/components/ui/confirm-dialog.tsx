"use client";

import { type ReactNode, useState, useEffect } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, Info } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

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
  verificationText?: string;
  verificationPlaceholder?: string;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  onClose?: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = "primary",
  loading = false,
  children,
  verificationText,
  verificationPlaceholder,
  onConfirm,
  onCancel,
  onClose,
}: ConfirmDialogProps) {
  const { t } = useTranslation("common");
  const isDanger = tone === "danger";
  const [verificationInput, setVerificationInput] = useState("");

  useEffect(() => {
    if (!open) {
      setVerificationInput("");
    }
  }, [open]);

  const isVerified = !verificationText || verificationInput.trim().toUpperCase() === verificationText.toUpperCase();
  const handleCancel = onClose || onCancel || (() => {});

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        // Radix requests close on Escape / overlay click; block while loading.
        if (!nextOpen && !loading) {
          handleCancel();
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ui-dialog-backdrop fixed inset-0 z-[90] transition-opacity duration-200 ease-out starting:opacity-0" />
        <DialogPrimitive.Content className="ui-dialog fixed left-1/2 top-1/2 z-[90] w-[calc(100vw-3rem)] max-w-[460px] -translate-x-1/2 -translate-y-1/2 overflow-hidden outline-none transition-[opacity,scale] duration-200 ease-out starting:scale-95 starting:opacity-0">
          <div className="px-7 pb-5 pt-7 sm:px-8">
            <div className="flex items-start gap-4">
              <div
                aria-hidden="true"
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
                <DialogPrimitive.Title className="text-[1.1rem] font-black tracking-tight text-on-surface">
                  {title}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="text-[13px] leading-6 text-ui-subtle">
                  {description}
                </DialogPrimitive.Description>
                {children ? <div className="pt-2">{children}</div> : null}
                {verificationText ? (
                  <div className="mt-4 space-y-1.5 rounded-lg border border-warning/15 bg-warning/[0.02] p-3 text-left">
                    <p className="text-[12px] font-black leading-relaxed text-warning-dim">
                      <Trans
                        t={t}
                        i18nKey="dialog.verificationPrompt"
                        values={{ text: verificationText }}
                        components={{ strong: <span className="font-mono rounded border border-warning/15 bg-warning/10 px-1 py-0.5 text-warning" /> }}
                      />
                    </p>
                    <input
                      type="text"
                      className="w-full rounded-md border border-on-surface/10 bg-surface px-3 py-1.5 text-[13px] font-mono outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 placeholder:text-on-surface-variant/30 text-on-surface"
                      placeholder={verificationPlaceholder || t("dialog.verificationPlaceholder", { text: verificationText })}
                      value={verificationInput}
                      disabled={loading}
                      onChange={(e) => setVerificationInput(e.target.value)}
                    />
                  </div>
                ) : null}
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
              {cancelLabel || t("dialog.cancel")}
            </Button>
            <Button
              variant={isDanger ? "danger" : "primary"}
              onClick={() => {
                if (isVerified) {
                  void onConfirm();
                }
              }}
              disabled={loading || !isVerified}
              loading={loading}
              className="flex-1"
            >
              {confirmLabel || t("dialog.confirm")}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
