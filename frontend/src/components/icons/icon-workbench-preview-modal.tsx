"use client";

import { useEffect, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { 
  X, 
  Download, 
  CheckCircle2, 
  RefreshCw, 
  Monitor, 
  Info,
  Maximize2,
  Sparkles,
  LoaderCircle,
  Search,
  ChevronRight,
  ChevronLeft,
  LayoutGrid,
  FolderOpen
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { saveFileAsTauri, isTauriDesktop } from "@/lib/runtime";

interface IconWorkbenchPreviewModalProps {
  src: string;
  localImagePath?: string; // 为 Tauri 提供的本地物理路径，解决 CORS 问题
  title?: string;
  subtitle?: string;
  folderName?: string;
  folderPath?: string;
  onClose: () => void;
  onApply?: () => void;
  onRegenerate?: () => void;
  onOpenFolder?: (path: string) => void;
  isApplying?: boolean;
  isApplied?: boolean;
  isCurrentVersion?: boolean;
  regenerateDisabled?: boolean;
  imageModelName?: string;
}

/**
 * Premium Studio Preview Modal
 * 提供高保真 Windows 风格模拟预览
 */
export function IconWorkbenchPreviewModal({
  src,
  localImagePath,
  title,
  subtitle,
  folderName,
  folderPath,
  onClose,
  onApply,
  onRegenerate,
  onOpenFolder,
  isApplying = false,
  isApplied = false,
  isCurrentVersion = false,
  regenerateDisabled = false,
  imageModelName,
}: IconWorkbenchPreviewModalProps) {
  const [showMockup, setShowMockup] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  const handleDownload = async () => {
    if (!src) return;
    setIsDownloading(true);
    setDownloadError(null);
    try {
      const filename = `icon-${folderName || "preview"}.png`;

      // 如果在 Tauri 环境中且有本地路径，优先使用原生全权限保存逻辑，绕过浏览器 CORS 限制
      if (isTauriDesktop() && localImagePath) {
        await saveFileAsTauri(localImagePath, filename);
        return;
      }

      // Web 降级逻辑（如果 CORS 允许）
      const response = await fetch(src);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Download failed", error);
      setDownloadError("下载失败。请在桌面版中保存，或对图片右键另存为。");
    } finally {
      setIsDownloading(false);
    }
  };

  const modalContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 lg:p-8">
      {/* Backdrop */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/85 backdrop-blur-md"
        onClick={onClose}
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="relative flex h-full max-h-[860px] w-full max-w-[1240px] flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[#0c0c0c] lg:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Mobile Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-white/5 px-6 py-4 lg:hidden">
          <div className="min-w-0">
             <h3 className="truncate text-[15px] font-black text-white">{folderName || "版本预览"}</h3>
             <p className="truncate text-[11px] font-bold text-white/40 uppercase tracking-widest">{subtitle}</p>
          </div>
          <button onClick={onClose} className="rounded-full bg-white/5 p-2 text-white/60 hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Left: Preview Area */}
        <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.03)_0%,transparent_100%)] p-8">
          <AnimatePresence mode="wait">
            {!showMockup ? (
              <motion.div
                key="raw-preview"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.1 }}
                className="relative"
              >
                <img
                  src={src}
                  alt={title}
                  onLoad={() => setIsLoaded(true)}
                  className={cn(
                    "max-h-[60vh] max-w-full rounded-2xl object-contain transition-all duration-700",
                    isLoaded ? "opacity-100 blur-0" : "opacity-0 blur-xl"
                  )}
                />
              </motion.div>
            ) : (
              <motion.div
                key="context-mockup"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="relative flex flex-col items-center gap-10"
              >
                 <div className="relative flex h-[480px] w-full max-w-[680px] flex-col overflow-hidden rounded-[8px] border border-white/10 bg-[#1e1e1e]">
                    <div className="flex h-12 items-center justify-between border-b border-white/5 bg-[#252525] px-4">
                       <div className="flex items-center gap-4">
                          <div className="flex items-center gap-3">
                             <ChevronLeft className="h-4 w-4 text-white/40" />
                             <ChevronRight className="h-4 w-4 text-white/40" />
                          </div>
                          <div className="flex items-center gap-2 text-[12px] text-white/60">
                             <span className="opacity-40">此电脑</span>
                             <ChevronRight className="h-3 w-3 opacity-20" />
                             <span className="opacity-40">图片</span>
                             <ChevronRight className="h-3 w-3 opacity-20" />
                             <span>演示目录</span>
                          </div>
                       </div>
                       
                       <div className="flex h-full items-center">
                          <div className="flex h-full items-center px-4 hover:bg-white/5">
                             <div className="h-px w-2.5 bg-white/60" />
                          </div>
                          <div className="flex h-full items-center px-4 hover:bg-white/5">
                             <div className="h-2.5 w-2.5 border border-white/60" />
                          </div>
                          <div className="flex h-full items-center px-4 hover:bg-red-600 transition-colors">
                             <X className="h-4 w-4 text-white/60" />
                          </div>
                       </div>
                    </div>

                    <div className="flex h-12 items-center gap-4 border-b border-white/5 bg-[#1e1e1e] px-4">
                       <div className="flex items-center gap-2 rounded-[4px] bg-white/5 px-3 py-1 text-[12px] font-medium text-white/80">
                          <LayoutGrid className="h-3.5 w-3.5" />
                          <span>查看</span>
                       </div>
                       <div className="ml-auto flex w-40 items-center justify-between rounded-[4px] border border-white/10 bg-white/5 px-2 py-1">
                          <span className="text-[11px] text-white/20">搜索图片...</span>
                          <Search className="h-3.5 w-3.5 text-white/20" />
                       </div>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto bg-[#191919] p-8">
                       <div className="grid grid-cols-4 gap-x-8 gap-y-12">
                          <div className="flex flex-col items-center gap-2.5 group cursor-default relative">
                             <div className="relative flex h-24 w-24 items-center justify-center">
                                <img 
                                  src={src} 
                                  className="h-full w-full object-contain transition-transform group-hover:scale-105" 
                                  alt="icon-as-folder" 
                                />
                                <div className="absolute -inset-3 ring-[1.5px] ring-primary/60 bg-primary/10 rounded-[6px] opacity-100" />
                             </div>
                             <div className="z-10 rounded-[3px] bg-primary px-3 py-1 text-[11px] font-black text-white">
                                {folderName || "扫描与报告"}
                             </div>
                          </div>

                          {[1, 2, 3].map((i) => (
                             <div key={i} className="flex flex-col items-center gap-3 opacity-10 filter grayscale pointer-events-none">
                                <div className="h-20 w-20 rounded-[8px] bg-white/20" />
                                <div className="h-3 w-16 rounded-full bg-white/10" />
                             </div>
                          ))}
                       </div>
                    </div>

                    <div className="h-7 border-t border-white/5 bg-[#252525] px-4 flex items-center justify-between text-[10px] text-white/20">
                       <span>已选择 1 个项目</span>
                       <div className="h-2 w-12 rounded-full bg-white/5" />
                    </div>
                 </div>
                 
                 <div className="space-y-1 text-center">
                    <p className="text-[14px] font-black text-white/50 tracking-tight">Windows 预览模拟</p>
                    <p className="text-[11px] font-medium text-white/25">当前展示图标直接作为文件夹图标后的视觉效果</p>
                 </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Toggle View Mode */}
          <div className="absolute bottom-8 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 p-1 backdrop-blur-md">
             <button 
               onClick={() => setShowMockup(false)}
               className={cn(
                 "flex h-9 items-center gap-2 rounded-full px-4 text-[12px] font-black transition-all",
                 !showMockup ? "bg-white text-black" : "text-white/60 hover:text-white"
               )}
             >
               <Maximize2 className="h-3.5 w-3.5" />
               单体预览
             </button>
             <button 
               onClick={() => setShowMockup(true)}
               className={cn(
                 "flex h-9 items-center gap-2 rounded-full px-4 text-[12px] font-black transition-all",
                 showMockup ? "bg-white text-black" : "text-white/60 hover:text-white"
               )}
             >
               <Monitor className="h-3.5 w-3.5" />
               系统模拟
             </button>
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="flex w-full shrink-0 flex-col border-white/5 bg-white/[0.02] lg:w-[320px] lg:border-l">
          <div className="hidden border-b border-white/5 p-8 lg:block">
            <div className="flex items-center justify-between">
               <div className="flex items-center gap-2 text-primary">
                  <Sparkles className="h-4 w-4" />
                  <span className="text-[11px] font-black uppercase tracking-[0.2em]">Studio Preview</span>
               </div>
               <button onClick={onClose} className="text-white/30 hover:text-white">
                 <X className="h-5 w-5" />
               </button>
            </div>
            <h2 className="mt-6 text-[1.4rem] font-black tracking-tight text-white">{folderName || "方案预览"}</h2>
            <p className="mt-1.5 text-[12px] font-bold text-white/40 uppercase tracking-[0.05em]">{subtitle}</p>
          </div>

          <div className="flex-1 space-y-8 overflow-y-auto p-6 lg:p-8">
             <div className="space-y-6">
                <div className="space-y-3">
                   <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-white/30">
                     <Info className="h-3 w-3" />
                     版本详情
                   </p>
                   <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-[12px] border border-white/5 bg-white/5 p-3">
                         <p className="text-[10px] font-bold text-white/30 uppercase">分辨率</p>
                         <p className="mt-1 text-[13px] font-black text-white/80">1024 × 1024</p>
                      </div>
                      <div className="rounded-[12px] border border-white/5 bg-white/5 p-3">
                         <p className="text-[10px] font-bold text-white/30 uppercase">状态</p>
                         <p className={cn(
                           "mt-1 text-[13px] font-black",
                           isApplied ? "text-success-dim" : "text-success-dim/60"
                         )}>
                            {isApplied ? "已应用" : "未应用"}
                         </p>
                         <p className="mt-1 text-[10px] font-bold leading-4 text-white/35">
                           {isCurrentVersion ? "这是当前版本，但当前版本不等于已应用。" : "可先设为当前版本，再决定是否应用。"}
                         </p>
                      </div>
                   </div>
                </div>

                <div className="space-y-3">
                   <p className="text-[11px] font-black uppercase tracking-widest text-white/30">生图模型</p>
                   <div className="flex items-center gap-2 rounded-[12px] border border-white/5 bg-white/5 px-4 py-3">
                      <div className="h-2 w-2 rounded-full bg-primary/60" />
                      <span className="text-[12px] font-bold text-white/70">
                        {imageModelName || "默认模型"}
                      </span>
                   </div>
                </div>
             </div>
          </div>

          <div className="mt-auto space-y-3 border-t border-white/5 p-6 lg:p-8">
             {downloadError && (
               <div className="rounded-[10px] border border-warning/25 bg-warning/10 px-3 py-2 text-[11px] font-bold leading-5 text-warning">
                 {downloadError}
               </div>
             )}

             {onApply && (
                <Button 
                  onClick={isApplied ? () => onOpenFolder?.(folderPath || "") : onApply} 
                  disabled={isApplying}
                  className={cn(
                    "h-14 w-full rounded-[12px] text-[15px] font-black text-white border border-white/10 transition-all",
                    isApplied 
                      ? "bg-success hover:bg-success" 
                      : "bg-primary hover:bg-primary/90"
                  )}
                >
                  {isApplying ? (
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                  ) : isApplied ? (
                    <FolderOpen className="mr-2 h-4 w-4" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  {isApplied ? "打开文件夹查看" : "应用到文件夹"}
                </Button>
             )}
             
             <div className="grid grid-cols-2 gap-2">
                <Button 
                  variant="secondary" 
                  onClick={onRegenerate}
                  disabled={regenerateDisabled}
                  className="h-11 rounded-[10px] border-white/10 bg-white/5 text-[12px] font-black text-white hover:bg-white/10 disabled:opacity-40"
                >
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  重新生成
                </Button>
                <Button 
                  variant="secondary"
                  onClick={handleDownload}
                  disabled={isDownloading}
                  className="h-11 rounded-[10px] border-white/10 bg-white/5 text-[12px] font-black text-white hover:bg-white/10"
                >
                   {isDownloading ? <LoaderCircle className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-2 h-3.5 w-3.5" />}
                   下载 PNG
                </Button>
             </div>
             
             <button 
               onClick={onClose}
               className="h-11 w-full text-[12px] font-bold text-white/40 hover:text-white"
             >
               取消预览
             </button>
          </div>
        </div>
      </motion.div>
    </div>
  );

  return createPortal(
    <AnimatePresence>
      {modalContent}
    </AnimatePresence>,
    document.body,
  );
}
