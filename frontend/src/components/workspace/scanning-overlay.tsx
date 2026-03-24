import { motion, AnimatePresence } from "framer-motion";
import { 
  Loader2, 
  Search, 
  CheckCircle2, 
  AlertCircle, 
  HelpCircle,
  Clock
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScannerProgress } from "@/types/session";
import { Button } from "@/components/ui/button";

interface ScanningOverlayProps {
  scanner: ScannerProgress;
  progressPercent: number;
}

export function ScanningOverlay({ scanner, progressPercent }: ScanningOverlayProps) {
  const status = scanner.status === 'failed' ? 'error' : 
                 scanner.status === 'completed' ? 'success' : 
                 scanner.status === 'idle' ? 'idle' : 'scanning';

  if (status === 'idle') return null;

  // 根据扫描深度映射语义化状态
  const getSemanticStatus = () => {
    if (status === 'success') return "扫描完成，正在构建文件关系图谱";
    if (status === 'error') return scanner.message || "分析请求被核心引擎中断";
    
    if (progressPercent < 30) return "AI 正在快速索引文件目录元数据...";
    if (progressPercent < 70) return "引擎正在深度提取文件特征并构建理解模型...";
    return "正在根据上下文语境生成目录分类建议...";
  };

  const recent_analysis_items = scanner.recent_analysis_items || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-8">
      {/* Dynamic Backdrop */}
      <motion.div 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        exit={{ opacity: 0 }}
        className={cn(
          "absolute inset-0 backdrop-blur-3xl transition-colors duration-1000",
          status === 'error' ? "bg-error/10" : "bg-white/80"
        )}
      />

      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 30 }}
        className="relative w-full max-w-2xl bg-white rounded-[40px] shadow-2xl border border-on-surface/5 overflow-hidden"
      >
        {/* Progress Bar */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-primary/5">
             <motion.div 
               className="h-full bg-primary"
               initial={{ width: 0 }}
               animate={{ width: `${progressPercent}%` }}
               transition={{ duration: 0.5 }}
             />
        </div>

        <div className="p-12 space-y-10">
          <div className="flex items-start justify-between">
            <div className="space-y-3">
              <div className="flex items-center gap-4">
                <div className={cn(
                  "p-3 rounded-2xl transition-colors duration-500",
                  status === 'error' ? "bg-error/10 text-error" : status === 'success' ? "bg-emerald-500/10 text-emerald-600" : "bg-primary/10 text-primary"
                )}>
                  {status === 'error' ? <AlertCircle className="w-6 h-6" /> : status === 'success' ? <CheckCircle2 className="w-6 h-6" /> : <Search className="w-6 h-6 animate-pulse" />}
                </div>
                <h2 className="text-2xl font-black font-headline text-on-surface tracking-tight leading-none uppercase tracking-widest">
                  {status === 'error' ? "扫描遇到阻碍" : "深度语义分析"}
                </h2>
              </div>
              <p className="text-[13px] text-on-surface-variant font-bold uppercase tracking-[0.2em] opacity-40">
                {getSemanticStatus()}
              </p>
            </div>
          </div>

          {/* Analysis Stream */}
          <div className="bg-surface-container-low/50 rounded-[32px] border border-on-surface/5 p-8 h-64 overflow-hidden relative">
            <div className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-surface-container-low to-transparent z-10" />
            <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-surface-container-low to-transparent z-10" />
            
            <div className="space-y-4">
              <AnimatePresence mode="popLayout">
                {recent_analysis_items.map((item, idx) => (
                  <motion.div 
                    key={item.path + idx}
                    initial={{ opacity: 0, x: -20, filter: "blur(10px)" }}
                    animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, x: 20 }}
                    className="flex flex-col gap-1.5"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary/20" />
                      <span className="text-[12px] font-mono text-on-surface-variant truncate opacity-60 italic">{item.path}</span>
                    </div>
                    {item.summary && (
                       <p className="pl-4 text-[13px] font-bold text-on-surface leading-relaxed border-l-2 border-primary/10 py-1">
                         {item.summary}
                       </p>
                    )}
                  </motion.div>
                )).reverse().slice(0, 4)}
              </AnimatePresence>
              
              {recent_analysis_items.length === 0 && status === 'scanning' && (
                <div className="h-full flex flex-col items-center justify-center gap-4 py-8 opacity-20">
                  <Loader2 className="w-8 h-8 animate-spin" />
                  <p className="text-[11px] font-black uppercase tracking-widest italic leading-none">Awaiting AI Pulse...</p>
                </div>
              )}

              {/* Error Actions (Wait for User to decide if they need retry buttons here or in parent) */}
              {status === 'error' && (
                <motion.div 
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="space-y-6 pt-4"
                >
                  <div className="flex flex-col gap-3">
                    <p className="text-[11px] font-black text-error uppercase tracking-widest pl-1">下一步建议：</p>
                    <div className="grid grid-cols-1 gap-2">
                       {[
                         "检查网络连接或 API 代理设置",
                         "确认目标目录是否有足够的读取权限",
                         "尝试减少扫描目录的文件深度"
                       ].map((tip, i) => (
                         <div key={i} className="flex items-center gap-3 bg-error/5 p-3 rounded-xl border border-error/10">
                           <HelpCircle className="w-3.5 h-3.5 text-error opacity-40 shrink-0" />
                           <span className="text-[13px] font-bold text-error/80">{tip}</span>
                         </div>
                       ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-on-surface/5 pt-8">
             <div className="flex items-center gap-3 text-on-surface-variant/30">
                <Clock className="w-4 h-4" />
                <span className="text-[11px] font-black uppercase tracking-[0.2em] italic">Precision Analysis Layer</span>
             </div>
             <div className="flex items-center gap-2">
                <span className="text-[11px] font-black text-primary uppercase tracking-widest opacity-60">Insight Engine v2</span>
                <div className="w-2 h-2 rounded-full bg-primary animate-ping" />
             </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
