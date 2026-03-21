"use client";

import { motion } from "motion/react";
import { AlertTriangle } from "lucide-react";

interface ErrorAlertProps {
  title?: string;
  message: string;
}

export function ErrorAlert({ title = "System Interruption", message }: ErrorAlertProps) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-6">
      <div className="w-8 h-8 rounded-md bg-error-container text-error flex items-center justify-center shrink-0 shadow-sm border border-error/10">
        <AlertTriangle className="w-4 h-4" />
      </div>
      <div className="bg-error-container/10 text-error p-5 rounded-md border border-error/20 flex-1 space-y-1 shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-[0.2em]">{title}</p>
        <p className="text-[13px] opacity-90 leading-relaxed font-sans">{message}</p>
      </div>
    </motion.div>
  );
}
