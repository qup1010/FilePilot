"use client";

import { motion } from "framer-motion";
import { AlertTriangle } from "lucide-react";

interface ErrorAlertProps {
  title?: string;
  message: string;
}

export function ErrorAlert({ title = "系统指令异常中断", message }: ErrorAlertProps) {
  return (
    <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex gap-6 p-1">
      <div className="w-10 h-10 rounded-2xl bg-error-container/10 text-error flex items-center justify-center shrink-0 border border-error/10 shadow-sm">
        <AlertTriangle className="w-5 h-5" />
      </div>
      <div className="bg-error-container/[0.03] text-error px-6 py-5 rounded-[24px] border border-error/10 flex-1 space-y-1.5 shadow-sm">
        <p className="text-[11px] font-black uppercase tracking-[0.25em] opacity-40 leading-none">{title}</p>
        <p className="text-[14px] font-bold leading-relaxed tracking-tight group-hover:underline transition-all">
          <span className="opacity-50 mr-2">—</span>
          {message}
        </p>
      </div>
    </motion.div>
  );
}
