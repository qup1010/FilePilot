"use client";

import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";

interface ErrorAlertProps {
  title?: string;
  message: string;
  onClose?: () => void;
}

export function ErrorAlert({ title = "系统指令异常中断", message, onClose }: ErrorAlertProps) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: -4 }} 
      animate={{ opacity: 1, y: 0 }} 
      className="flex items-start gap-4 rounded-xl border border-error/15 bg-error/[0.02] p-4"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-error/10 text-error">
        <AlertTriangle className="h-4.5 w-4.5" />
      </div>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-error/60 leading-none">
            {title}
          </p>
          {onClose && (
            <button 
              onClick={onClose}
              className="rounded-full p-1 text-ui-muted opacity-20 hover:bg-error/10 hover:text-error hover:opacity-100 transition-all"
            >
              <span className="sr-only">关闭</span>
              <div className="h-3.5 w-3.5 flex items-center justify-center">
                <div className="h-0.5 w-3 bg-current rotate-45 absolute" />
                <div className="h-0.5 w-3 bg-current -rotate-45 absolute" />
              </div>
            </button>
          )}
        </div>
        <p className="text-[13px] font-bold leading-relaxed tracking-tight text-on-surface/80">
          {message}
        </p>
      </div>
    </motion.div>
  );
}
