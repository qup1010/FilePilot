import { motion, AnimatePresence } from "motion/react";
import { Loader2 } from "lucide-react";

export function LaunchTransitionOverlay({ open, targetDir }: { open: boolean; targetDir: string }) {
  const folderName = targetDir.replace(/[\\/]$/, "").split(/[\\/]/).pop() || "当前目录";

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none fixed inset-0 z-[120] flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(10,132,255,0.12),transparent_42%),rgba(244,247,250,0.82)] px-6 backdrop-blur-md"
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-[420px] overflow-hidden rounded-[18px] border border-on-surface/12 bg-surface/96 p-6"
          >
            <div className="flex items-start gap-4">
              <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-[16px] border border-primary/16 bg-primary/8 text-primary">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
                >
                  <Loader2 className="h-6 w-6" />
                </motion.div>
                <motion.span
                  animate={{ scale: [1, 1.3, 1], opacity: [0.22, 0.08, 0.22] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute inset-0 rounded-[16px] border border-primary/20"
                />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/72">
                  正在打开整理工作区
                </p>
                <h3 className="mt-2 text-[22px] font-black tracking-tight text-on-surface">
                  正在准备读取目录
                </h3>
                <p className="mt-2 text-[13px] leading-6 text-on-surface-variant/78">
                  已确认整理对象，正在进入只读扫描阶段。
                </p>

                <div className="mt-4 rounded-[12px] border border-on-surface/8 bg-surface-container-low/70 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-[13px] font-semibold text-on-surface">{folderName}</span>
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                      等待读取
                    </span>
                  </div>
                  <div className="mt-3 flex gap-1.5">
                    {[0, 1, 2].map((index) => (
                      <motion.span
                        key={index}
                        animate={{ opacity: [0.28, 1, 0.28], y: [0, -2, 0] }}
                        transition={{ duration: 0.9, repeat: Infinity, delay: index * 0.14, ease: "easeInOut" }}
                        className="h-1.5 w-1.5 rounded-full bg-primary"
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
