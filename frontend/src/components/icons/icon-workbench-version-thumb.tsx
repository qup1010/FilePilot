"use client";

import { useEffect, useState } from "react";
import { Check, LoaderCircle, AlertCircle, Maximize2, Scissors, Trash2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IconPreviewVersion } from "@/types/icon-workbench";
import { buildImageSrc } from "./icon-workbench-utils";

interface IconWorkbenchVersionThumbProps {
  version: IconPreviewVersion;
  isSelected: boolean;
  isApplied?: boolean;
  onSelect: () => void;
  onZoom: () => void;
  onApply: () => void;
  onRemoveBg: () => void;
  onDelete: () => void;
  baseUrl: string;
  apiToken: string;
  isApplying?: boolean;
  isRemovingBg?: boolean;
  isProcessing?: boolean;
}

export function IconWorkbenchVersionThumb({
  version,
  isSelected,
  isApplied = false,
  onSelect,
  onZoom,
  onApply,
  onRemoveBg,
  onDelete,
  baseUrl,
  apiToken,
  isApplying = false,
  isRemovingBg = false,
  isProcessing = false,
}: IconWorkbenchVersionThumbProps) {
  const isReady = version.status === "ready";
  const isGenerating = version.status === "generating";
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const imgSrc = isReady ? buildImageSrc(version, baseUrl, apiToken) : "";

  useEffect(() => {
    setImageLoaded(false);
    setImageFailed(false);
  }, [version.version_id, imgSrc]);

  return (
    <div
      onClick={onSelect}
      className={cn(
        "group/version relative flex w-[88px] shrink-0 cursor-pointer flex-col overflow-hidden border transition-all duration-200 rounded-md",
        isSelected
          ? "border-primary bg-primary/[0.03] ring-1 ring-primary/20"
          : "border-on-surface/8 bg-surface-container-low hover:border-on-surface/20",
      )}
    >
      {/* 缩略图主体 */}
      <div className="relative aspect-square overflow-hidden bg-surface">
        {isReady ? (
          <>
            {!imageLoaded && !imageFailed && (
              <div className="absolute inset-0 flex items-center justify-center">
                <LoaderCircle className="h-4 w-4 animate-spin text-primary/20" />
              </div>
            )}
            <img
              src={imgSrc}
              alt="v"
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageFailed(true)}
              className={cn("h-full w-full object-cover transition-opacity", imageLoaded ? "opacity-100" : "opacity-0")}
            />
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {isGenerating ? <LoaderCircle className="h-4 w-4 animate-spin text-primary/30" /> : <AlertCircle className="h-4 w-4 text-error/30" />}
          </div>
        )}

        {/* 顶部标签 */}
        <div className="absolute left-1 top-1 flex items-center gap-1">
           <span className="rounded bg-black/60 px-1 py-0.5 text-[11px] font-black text-white/90 backdrop-blur-sm">V{version.version_number}</span>
           {isSelected && !isApplied && (
             <span className="rounded bg-primary/80 px-1 py-0.5 text-[11px] font-black text-white/90 backdrop-blur-sm">当前版本</span>
           )}
           {isApplied && (
             <span className="rounded bg-primary/80 px-1 py-0.5 text-[11px] font-black text-white/90 backdrop-blur-sm">已应用</span>
           )}
           {isApplied && (
             <div className="bg-primary rounded-full p-0.5 ring-1 ring-white/20">
               <Check className="h-1.5 w-1.5 text-white stroke-[4]" />
             </div>
           )}
        </div>

        {/* Hover 操作浮层 */}
        {isReady && !isProcessing && (
          <div className="absolute inset-x-0 bottom-0 flex h-7 translate-y-full items-center justify-around bg-black/70 px-1 backdrop-blur-md transition-transform group-hover/version:translate-y-0">
             <button aria-label="放大预览" onClick={(e) => { e.stopPropagation(); onZoom(); }} className="p-1 text-white hover:text-primary transition-colors"><Maximize2 className="h-3 w-3" /></button>
             <button aria-label="去除背景" onClick={(e) => { e.stopPropagation(); onRemoveBg(); }} className="p-1 text-white hover:text-primary transition-colors"><Scissors className="h-3 w-3" /></button>
             <button aria-label={isApplied ? "重新应用" : "应用到系统"} onClick={(e) => { e.stopPropagation(); onApply(); }} className="p-1 text-white hover:text-primary transition-colors"><CheckCircle2 className="h-3.5 w-3.5 text-primary" /></button>
             <button aria-label="删除版本" onClick={(e) => { e.stopPropagation(); onDelete(); }} className="p-1 text-white hover:text-error transition-colors"><Trash2 className="h-3 w-3" /></button>
          </div>
        )}

        {/* 覆盖状态提示 */}
        {(isApplying || isRemovingBg) && (
           <div className="absolute inset-0 z-30 flex items-center justify-center bg-surface/60 backdrop-blur-[1px]">
              <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
           </div>
        )}
      </div>
    </div>
  );
}
