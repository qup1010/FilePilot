"use client";

import React, { useMemo } from "react";
import { ArrowRight, Folder } from "lucide-react";
import { cn } from "@/lib/utils";

interface PathDiffViewerProps {
  source: string;
  target: string;
  compact?: boolean;
}

export function PathDiffViewer({ source, target, compact = false }: PathDiffViewerProps) {
  const diff = useMemo(() => {
    if (!source || !target) {
      return {
        commonRoot: "",
        sourceRel: source || "",
        targetRel: target || "",
        sourceFolders: [] as string[],
        targetFolders: [] as string[],
        fileName: "",
      };
    }

    // 标准化反斜杠并按斜杠分割
    const sParts = source.replace(/\\/g, "/").split("/");
    const tParts = target.replace(/\\/g, "/").split("/");

    // 提取文件名 (最后一个段)
    const sFileName = sParts[sParts.length - 1] || "";
    const tFileName = tParts[tParts.length - 1] || "";
    const fileName = tFileName || sFileName;

    // 计算公共前缀 (不包含文件名自身)
    let commonCount = 0;
    const maxCommon = Math.min(sParts.length - 1, tParts.length - 1);
    while (
      commonCount < maxCommon &&
      sParts[commonCount].toLowerCase() === tParts[commonCount].toLowerCase()
    ) {
      commonCount++;
    }

    const commonRootParts = sParts.slice(0, commonCount);
    const commonRoot = commonRootParts.join("/");

    const sRelParts = sParts.slice(commonCount);
    const tRelParts = tParts.slice(commonCount);

    // 分离出文件夹段和文件名
    const sourceFolders = sRelParts.slice(0, -1);
    const targetFolders = tRelParts.slice(0, -1);

    return {
      commonRoot,
      sourceFolders,
      targetFolders,
      fileName,
    };
  }, [source, target]);

  const { commonRoot, sourceFolders, targetFolders, fileName } = diff;

  // 格式化公共根的显示缩写
  const displayCommonRoot = useMemo(() => {
    if (!commonRoot) return "";
    const parts = commonRoot.split("/");
    if (parts.length <= 2) return commonRoot + "/";
    // 如果太长，在 compact 模式下缩写前缀部分
    if (compact && parts.length > 3) {
      return `${parts[0]}/.../${parts.slice(-2).join("/")}/`;
    }
    return commonRoot + "/";
  }, [commonRoot, compact]);

  const isReview = useMemo(() => {
    return target.split(/[\\/]/).some((part) => part.toLowerCase() === "review");
  }, [target]);

  if (compact) {
    // 弹窗内的紧凑单行/双行排版
    return (
      <div className="flex flex-col gap-1 w-full text-[11px] font-mono leading-normal">
        {/* 源路径 */}
        <div className="flex items-center gap-1.5 text-on-surface/40 min-w-0">
          <span className="shrink-0 w-8 text-[9px] font-black uppercase tracking-wider text-ui-muted/50">FROM</span>
          <div className="truncate flex items-center">
            {displayCommonRoot && (
              <span className="opacity-60 select-none truncate max-w-[120px]">{displayCommonRoot}</span>
            )}
            {sourceFolders.map((folder, idx) => (
              <span
                key={idx}
                className="shrink-0 rounded-[3px] bg-error/5 text-error/80 px-1 py-0.5 mx-0.5 border border-error/5"
              >
                {folder}
              </span>
            ))}
            {sourceFolders.length > 0 && <span className="opacity-40 mx-0.5">/</span>}
            <span className="font-bold opacity-80">{fileName}</span>
          </div>
        </div>

        {/* 目标路径 */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="shrink-0 w-8 text-[9px] font-black uppercase tracking-wider text-primary/65">TO</span>
          <div className="truncate flex items-center">
            {displayCommonRoot && (
              <span className="opacity-30 select-none truncate max-w-[120px]">{displayCommonRoot}</span>
            )}
            {targetFolders.map((folder, idx) => {
              const isReviewSegment = folder.toLowerCase() === "review";
              return (
                <span
                  key={idx}
                  className={cn(
                    "shrink-0 rounded-[3px] px-1 py-0.5 mx-0.5 border",
                    isReviewSegment
                      ? "bg-warning/10 text-warning border-warning/15 font-black"
                      : "bg-success/5 text-success-dim border-success/10"
                  )}
                >
                  {folder}
                </span>
              );
            })}
            {targetFolders.length > 0 && <span className="opacity-40 mx-0.5">/</span>}
            <span className={cn("font-black", isReview ? "text-warning" : "text-primary")}>
              {fileName}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // 预检页面的对等分栏/高密度宽版排版
  return (
    <div className="grid gap-4 sm:grid-cols-2 w-full text-[11.5px] font-mono leading-relaxed">
      {/* 原始位置 */}
      <div className="flex items-start gap-2 rounded-md border border-on-surface/5 bg-on-surface/[0.01] p-2.5 min-w-0">
        <div className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded bg-error/10 text-error">
          <Folder className="h-3 w-3" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="block text-[8.5px] font-black uppercase tracking-widest text-ui-muted opacity-40 mb-1 leading-none">
            源路径 (FROM)
          </span>
          <div className="flex flex-wrap items-center text-on-surface/70">
            {displayCommonRoot && (
              <span className="opacity-40 select-none whitespace-nowrap">{displayCommonRoot}</span>
            )}
            {sourceFolders.map((folder, idx) => (
              <span
                key={idx}
                className="rounded-[3px] bg-error/5 text-error/80 px-1 py-0.5 mx-0.5 my-0.5 border border-error/5 text-[10.5px]"
              >
                {folder}
              </span>
            ))}
            {sourceFolders.length > 0 && <span className="opacity-30 mx-0.5">/</span>}
            <span className="font-bold text-on-surface/90">{fileName}</span>
          </div>
        </div>
      </div>

      {/* 目标位置 */}
      <div
        className={cn(
          "flex items-start gap-2 rounded-md border p-2.5 min-w-0",
          isReview
            ? "border-warning/20 bg-warning/[0.01]"
            : "border-primary/10 bg-primary/[0.01]"
        )}
      >
        <div
          className={cn(
            "mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded",
            isReview ? "bg-warning/10 text-warning" : "bg-primary/10 text-primary"
          )}
        >
          <Folder className="h-3 w-3" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="block text-[8.5px] font-black uppercase tracking-widest text-ui-muted opacity-40 mb-1 leading-none">
            目标路径 (TO)
          </span>
          <div className="flex flex-wrap items-center">
            {displayCommonRoot && (
              <span className="opacity-30 select-none whitespace-nowrap">{displayCommonRoot}</span>
            )}
            {targetFolders.map((folder, idx) => {
              const isReviewSegment = folder.toLowerCase() === "review";
              return (
                <span
                  key={idx}
                  className={cn(
                    "rounded-[3px] px-1 py-0.5 mx-0.5 my-0.5 border text-[10.5px] font-medium",
                    isReviewSegment
                      ? "bg-warning/10 text-warning border-warning/15 font-black"
                      : "bg-success/5 text-success-dim border-success/10"
                  )}
                >
                  {folder}
                </span>
              );
            })}
            {targetFolders.length > 0 && <span className="opacity-30 mx-0.5">/</span>}
            <span className={cn("font-black", isReview ? "text-warning" : "text-primary")}>
              {fileName}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
