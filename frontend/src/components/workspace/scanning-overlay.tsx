"use client";

import { motion, AnimatePresence } from "motion/react";
import { FileSearch, Activity, Layers, Tag } from "lucide-react";
import { ScannerProgress } from "@/types/session";

interface ScanningOverlayProps {
  scanner: ScannerProgress;
  progressPercent: number;
}

export function ScanningOverlay({ scanner, progressPercent }: ScanningOverlayProps) {
  return (
    <motion.div 
      initial={{opacity: 0}} animate={{opacity: 1}}
      className="p-10 rounded-md bg-white border border-on-surface/5 shadow-sm space-y-8"
    >
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-surface-container-low rounded-md flex items-center justify-center text-primary shrink-0 transition-all">
          <FileSearch className="w-6 h-6 animate-pulse" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-bold font-headline text-on-surface tracking-tight">扫描目录元数据中</h3>
          <p className="text-[10px] text-on-surface-variant uppercase tracking-widest font-black opacity-40">架构分析阶段</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex justify-between text-[11px] font-bold text-on-surface-variant tabular-nums">
          <span>进度</span>
          <span>{Math.round(progressPercent)}%</span>
        </div>
        <div className="h-1 bg-surface-container-low rounded-full overflow-hidden flex relative">
          <motion.div 
            initial={{width: 0}} animate={{width: `${progressPercent}%`}}
            className="h-full bg-primary"
          />
        </div>
      </div>

      {scanner.current_item && (
        <div className="p-3 bg-surface-container-low/50 rounded-md flex items-center gap-3">
           <Activity className="w-3 h-3 text-primary animate-pulse min-w-[12px]" />
           <span className="text-[10px] text-on-surface-variant font-mono truncate">ID: {scanner.current_item.split(/[\\/]/).pop()}</span>
           <span className="ml-auto text-[9px] text-on-surface-variant opacity-40 uppercase tabular-nums">{scanner.processed_count}/{scanner.total_count}</span>
        </div>
      )}

      {/* Live Stream of Recent Analysis Results */}
      {scanner.recent_analysis_items && scanner.recent_analysis_items.length > 0 && (
        <div className="pt-4 border-t border-on-surface/5 space-y-4">
          <h4 className="text-[9px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40 flex items-center gap-2">
            <Layers className="w-3 h-3" /> 最新元数据解码
          </h4>
          <div className="space-y-3 relative overflow-hidden h-[120px]">
            <AnimatePresence>
              {scanner.recent_analysis_items.slice(0, 3).map((item, idx) => (
                <motion.div 
                  key={item.item_id}
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1 - idx * 0.3, y: idx * 42, scale: 1 - idx * 0.02 }}
                  className="absolute top-0 left-0 right-0 p-3 bg-white border border-on-surface/5 rounded-md flex flex-col gap-1.5 shadow-xs"
                  style={{ zIndex: 10 - idx }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] font-bold text-on-surface truncate flex-1 leading-none">{item.display_name}</span>
                    <span className="text-[9px] font-black uppercase tracking-widest text-primary shrink-0 bg-primary/5 px-2 py-0.5 rounded flex items-center gap-1">
                      <Tag className="w-2.5 h-2.5" />
                      {item.suggested_purpose}
                    </span>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}
    </motion.div>
  );
}
