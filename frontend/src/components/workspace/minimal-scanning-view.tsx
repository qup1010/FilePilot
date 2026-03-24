"use client";

import React from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScannerProgress } from "@/types/session";

interface MinimalScanningViewProps {
  scanner: ScannerProgress;
  progressPercent: number;
}

export function MinimalScanningView({ scanner, progressPercent }: MinimalScanningViewProps) {
  const currentItem = scanner.current_item || "正在准备扫描";
  
  return (
    <div className="h-full w-full flex flex-col items-center justify-center p-20 bg-surface">
      <div className="w-full max-w-md space-y-12">
        {/* Status Section */}
        <div className="space-y-4 text-center">
          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex justify-center"
          >
            <div className="w-16 h-16 rounded-3xl bg-white shadow-xl shadow-primary/5 border border-on-surface/5 flex items-center justify-center text-primary">
              <Loader2 className="w-8 h-8 animate-spin-slow" />
            </div>
          </motion.div>
          
          <div className="space-y-1">
            <h2 className="text-xl font-black text-on-surface uppercase tracking-tight font-headline">
              正在同步目录结构
            </h2>
            <p className="text-[11px] font-black text-on-surface-variant/40 uppercase tracking-[0.3em]">
              AI 正在分析文件元数据与用途
            </p>
          </div>
        </div>

        {/* Progress Section */}
        <div className="space-y-6">
          <div className="relative pt-1">
            <div className="flex mb-4 items-center justify-between">
              <div>
                <span className="text-[10px] font-black inline-block py-1 px-3 uppercase rounded-full text-primary bg-primary/8 border border-primary/10 tracking-widest">
                  实时扫描进度
                </span>
              </div>
              <div className="text-right">
                <span className="text-sm font-black inline-block text-on-surface tabular-nums">
                  {Math.round(progressPercent)}%
                </span>
              </div>
            </div>
            
            <div className="overflow-hidden h-1.5 mb-4 text-xs flex rounded-full bg-on-surface/5">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(2, progressPercent)}%` }}
                transition={{ duration: 0.5, ease: "easeOut" }}
                className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-primary rounded-full"
              />
            </div>
          </div>

          {/* Current File Banner */}
          <div className="bg-white/50 border border-on-surface/5 rounded-2xl p-4 flex items-center gap-4 transition-all">
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-black text-on-surface-variant/40 uppercase tracking-widest mb-0.5">当前正在处理</p>
              <p className="text-[13px] font-bold text-on-surface truncate pr-2 uppercase italic opacity-80">
                {currentItem}
              </p>
            </div>
          </div>
        </div>
        
        {/* Minimal Tip */}
        <p className="text-center text-[10px] font-bold text-on-surface-variant/20 uppercase tracking-[0.2em]">
          读取完成后，AI 将在此展示整理预览
        </p>
      </div>
    </div>
  );
}
