import * as DialogPrimitive from "@radix-ui/react-dialog";
import { History } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { getFriendlyStage } from "@/lib/utils";
import { StrategySummaryChips } from "./strategy-summary-chips";
import { SessionSnapshot, SessionStrategySummary } from "@/types/session";

export function ResumePromptDialog({
  open,
  targetDir,
  resumePrompt,
  resumeStrategy,
  isCompletedResume,
  onConfirmResume,
  onStartFresh,
  onReadOnlyView,
  onCancel,
}: {
  open: boolean;
  targetDir: string;
  resumePrompt: { sessionId: string; snapshot: SessionSnapshot } | null;
  resumeStrategy: SessionStrategySummary;
  isCompletedResume: boolean;
  onConfirmResume: () => void;
  onStartFresh: () => void;
  onReadOnlyView: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation("common");
  if (!resumePrompt) return null;

  const isStaleResume = resumePrompt.snapshot.stage === "stale";
  const primaryLabel = isCompletedResume
    ? t("launcher.resume.viewResult")
    : isStaleResume
      ? t("launcher.resume.openReview")
      : t("launcher.resume.continue");
  const taskStatus = isCompletedResume
    ? t("launcher.resume.completedStatus")
    : isStaleResume
      ? t("launcher.resume.staleStatus")
      : t("launcher.resume.pendingStatus");
  const stageLabel = t(`workspaceStage.${resumePrompt.snapshot.stage}`, {
    defaultValue: getFriendlyStage(resumePrompt.snapshot.stage),
  });

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        // Radix requests close on Escape / overlay click; route to the cancel path.
        if (!nextOpen) {
          onCancel();
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-surface/78 backdrop-blur-md transition-opacity duration-200 ease-out starting:opacity-0" />
        <DialogPrimitive.Content className="ui-dialog fixed left-1/2 top-1/2 z-[60] w-[calc(100vw-2rem)] max-w-[760px] -translate-x-1/2 -translate-y-1/2 bg-surface-container-lowest p-6 outline-none transition-[opacity,scale] duration-200 ease-out starting:scale-95 starting:opacity-0 sm:p-7">
          <div className="mb-6 flex items-center gap-4">
            <div
              aria-hidden="true"
              className="flex h-12 w-12 items-center justify-center rounded-[8px] border border-primary/12 bg-primary/10 text-primary"
            >
              <History className="h-6 w-6" />
            </div>
            <div className="space-y-1">
              <DialogPrimitive.Title className="text-xl font-black font-headline text-on-surface tracking-tight">
                {isCompletedResume ? t("launcher.resume.completedTitle") : isStaleResume ? t("launcher.resume.staleTitle") : t("launcher.resume.pendingTitle")}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-ui-body font-medium text-ui-muted">
                {isCompletedResume
                  ? t("launcher.resume.completedDescription")
                  : isStaleResume
                    ? t("launcher.resume.staleDescription")
                    : t("launcher.resume.pendingDescription")}
              </DialogPrimitive.Description>
            </div>
          </div>

          <p className="mb-5 text-sm leading-relaxed text-on-surface-variant">
            <Trans
              i18nKey="launcher.resume.summary"
              values={{ folder: targetDir.split(/[\\/]/).pop(), taskStatus, stage: stageLabel }}
              components={{ strong: <strong />, em: <em /> }}
            />
          </p>

          <div className="mb-6 rounded-[8px] border border-on-surface/8 bg-surface px-5 py-5">
            <p className="text-ui-section font-semibold text-ui-muted">{t("launcher.resume.previousSettings")}</p>
            <StrategySummaryChips strategy={resumeStrategy} />
          </div>

          <div className="flex flex-col gap-4">
            <Button
              variant="primary"
              onClick={onConfirmResume}
              className="w-full py-4 text-sm"
            >
              {primaryLabel}
            </Button>
            <div className="rounded-[8px] border border-on-surface/8 bg-surface px-5 py-4 text-ui-section font-medium leading-relaxed text-ui-muted">
              {isCompletedResume
                ? t("launcher.resume.completedRestartNote")
                : isStaleResume
                  ? t("launcher.resume.staleRestartNote")
                  : t("launcher.resume.pendingRestartNote")}
            </div>
            <div className={isCompletedResume ? "grid grid-cols-2 gap-3" : "grid grid-cols-3 gap-3"}>
              <Button
                variant="secondary"
                onClick={onStartFresh}
                className="py-3.5"
              >
                {t("launcher.resume.startFresh")}
              </Button>
              {!isCompletedResume ? (
                <Button
                  variant="secondary"
                  onClick={onReadOnlyView}
                  className="py-3.5"
                >
                  {t("launcher.resume.readOnly")}
                </Button>
              ) : null}
              <Button
                variant="ghost"
                onClick={onCancel}
                className="py-3.5"
              >
                {t("launcher.resume.cancel")}
              </Button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
