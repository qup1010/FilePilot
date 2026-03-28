"use client";

import React, { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface IconWorkbenchPreviewModalProps {
  src: string;
  title?: string;
  subtitle?: string;
  onClose: () => void;
}

/**
 * 全屏大图预览 Modal
 * 通过 API URL 直接加载图片，不走 Tauri invoke
 */
export function IconWorkbenchPreviewModal({
  src,
  title,
  subtitle,
  onClose,
}: IconWorkbenchPreviewModalProps) {
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

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* 关闭按钮 */}
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
        title="关闭 (ESC)"
      >
        <X className="h-5 w-5" />
      </button>

      {/* 大图容器 */}
      <div
        className="relative max-h-[80vh] max-w-[80vw]"
        onClick={(event: React.MouseEvent) => event.stopPropagation()}
      >
        <img
          src={src}
          alt={title || "图标预览"}
          className="max-h-[80vh] max-w-[80vw] rounded-xl object-contain shadow-[0_24px_80px_rgba(0,0,0,0.5)]"
          onError={(event: React.SyntheticEvent<HTMLImageElement, Event>) => {
            (event.target as HTMLImageElement).style.display = "none";
          }}
        />
      </div>

      {/* 底部信息 */}
      {(title || subtitle) ? (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-lg bg-black/50 px-4 py-2 text-center backdrop-blur-sm">
          {title ? (
            <p className="text-[14px] font-bold text-white">{title}</p>
          ) : null}
          {subtitle ? (
            <p className="mt-0.5 text-[12px] text-white/70">{subtitle}</p>
          ) : null}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
