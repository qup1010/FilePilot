import { motion, AnimatePresence } from "framer-motion";
import { History } from "lucide-react";
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
  if (!resumePrompt) return null;

  const isStaleResume = resumePrompt.snapshot.stage === "stale";
  const primaryLabel = isCompletedResume ? "查看整理结果" : isStaleResume ? "打开复核" : "继续整理";

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-surface/78 backdrop-blur-md p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="ui-dialog w-full max-w-[760px] bg-surface-container-lowest p-6 sm:p-7"
          >
            <div className="mb-6 flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-[8px] border border-primary/12 bg-primary/10 text-primary">
                <History className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-black font-headline text-on-surface tracking-tight">
                  {isCompletedResume ? "发现之前的整理记录" : isStaleResume ? "发现需要复核的整理记录" : "发现可继续的整理任务"}
                </h2>
                <p className="text-ui-body font-medium text-ui-muted">
                  {isCompletedResume
                    ? "你可以先查看之前的结果，也可以按这次的设置重新开始"
                    : isStaleResume
                      ? "上一次方案已过期，你可以打开复核，也可以按当前设置重新开始"
                    : "你可以接着处理，也可以按当前设置重新开始"}
                </p>
              </div>
            </div>

            <p className="mb-5 text-sm leading-relaxed text-on-surface-variant">
              检测到这次来源和设置（<strong>{targetDir.split(/[\\/]/).pop()}</strong>）
              {isCompletedResume ? "之前已经整理过一次" : isStaleResume ? "有一条需要复核的记录" : "还有一条未完成的任务"}（当前状态：
              <em>{getFriendlyStage(resumePrompt.snapshot.stage)}</em>）。
            </p>

            <div className="mb-6 rounded-[10px] border border-on-surface/8 bg-surface px-5 py-5">
              <p className="text-ui-section font-semibold text-ui-muted">上一次使用的设置</p>
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
              <div className="rounded-[10px] border border-on-surface/8 bg-surface px-5 py-4 text-ui-section font-medium leading-relaxed text-ui-muted">
                {isCompletedResume
                  ? "重新开始会按当前来源和设置重新读取目录。"
                  : isStaleResume
                    ? "重新开始会按当前来源和设置生成一条新任务，旧记录仍可在历史中查看。"
                  : "重新开始会结束上一次未完成的状态，并按当前来源和设置重新读取目录。"}
              </div>
              <div className={isCompletedResume ? "grid grid-cols-2 gap-3" : "grid grid-cols-3 gap-3"}>
                <Button
                  variant="secondary"
                  onClick={onStartFresh}
                  className="py-3.5"
                >
                  重新开始
                </Button>
                {!isCompletedResume ? (
                  <Button
                    variant="secondary"
                    onClick={onReadOnlyView}
                    className="py-3.5"
                  >
                    只读打开
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  onClick={onCancel}
                  className="py-3.5"
                >
                  取消
                </Button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
