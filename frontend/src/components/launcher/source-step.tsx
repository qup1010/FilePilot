import type { RefObject } from "react";
import { ChevronDown, FolderOpen, Layers3, Plus, ShieldAlert, Upload } from "lucide-react";
import { motion } from "motion/react";

import type { SourceDraftType } from "@/lib/launcher-sources";
import { cn } from "@/lib/utils";
import type { SessionSourceSelection } from "@/types/session";
import { Button } from "@/components/ui/button";
import { DropZoneOverlay, getDropZoneSurfaceClassName } from "@/components/ui/drop-zone-feedback";
import { SourceListPanel, type LauncherSourceListItem } from "./source-list";

interface SourceStepProps {
  sourceDropZoneRef: RefObject<HTMLDivElement | null>;
  loading: boolean;
  isDropActive: boolean;
  isDraggingGlobal: boolean;
  isDesktopEnvironment: boolean;
  isSourceDropdownOpen: boolean;
  onSetSourceDropdownOpen: (open: boolean) => void;
  showManualInput: boolean;
  onSetShowManualInput: (show: boolean) => void;
  commonDirs: { label: string; path: string }[];
  sourceDraftType: SourceDraftType;
  onSetSourceDraftType: (value: SourceDraftType) => void;
  sourceDraftPath: string;
  onSetSourceDraftPath: (value: string) => void;
  onAddManualSource: () => void;
  onImportDirectoryEntries: () => void;
  onChooseDirectories: () => void;
  onChooseFiles: () => void;
  onImportCommonDir: (path: string) => void;
  listItems: LauncherSourceListItem[];
  sourceStats: { total: number; directoryCount: number; fileCount: number };
  showClearConfirm: boolean;
  onClearSources: () => void;
  onRemoveSource: (path: string, sourceType: SessionSourceSelection["source_type"]) => void;
  onImportInternal: (item: SessionSourceSelection) => void;
  onSetAtomicMode: (path: string) => void;
  onToggleGroupExpanded: (groupId: string) => void;
  onRemoveGroup: (groupId: string) => void;
}

export function SourceStep({
  sourceDropZoneRef,
  loading,
  isDropActive,
  isDraggingGlobal,
  isDesktopEnvironment,
  isSourceDropdownOpen,
  onSetSourceDropdownOpen,
  showManualInput,
  onSetShowManualInput,
  commonDirs,
  sourceDraftType,
  onSetSourceDraftType,
  sourceDraftPath,
  onSetSourceDraftPath,
  onAddManualSource,
  onImportDirectoryEntries,
  onChooseDirectories,
  onChooseFiles,
  onImportCommonDir,
  listItems,
  sourceStats,
  showClearConfirm,
  onClearSources,
  onRemoveSource,
  onImportInternal,
  onSetAtomicMode,
  onToggleGroupExpanded,
  onRemoveGroup,
}: SourceStepProps) {
  const hasSources = sourceStats.total > 0;

  return (
    <div className="space-y-4">
      <div className="mb-1 flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-[4px] bg-primary/10 text-primary">
          <Upload className="h-3.5 w-3.5" />
        </div>
        <h2 className="text-[14px] font-bold text-on-surface">本次整理对象</h2>
      </div>
      {!hasSources && (
        <div className="rounded-[8px] border border-warning/15 bg-warning/[0.035] px-4 py-3 text-warning">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-warning/10">
              <ShieldAlert className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-black tracking-tight text-on-surface">整理前安全建议</div>
              <p className="mt-1 text-[12px] font-medium leading-5 text-ui-muted">
                建议从下载、桌面、文档等文件夹开始；避免磁盘根目录、系统目录、软件安装目录和开发中的工程。
              </p>
            </div>
          </div>
        </div>
      )}
      {!hasSources ? (
        <motion.div
          ref={sourceDropZoneRef}
          animate={{
            scale: isDropActive ? 1.01 : 1,
          }}
          className={cn(
            getDropZoneSurfaceClassName({
              isActive: isDropActive,
              isDraggingGlobal,
              idleClassName: "border-on-surface/10 bg-on-surface/[0.015] hover:bg-on-surface/[0.03]",
              draggingClassName: "border-primary/30 bg-primary/[0.015]",
              activeClassName: "border-primary/45 bg-primary/8 text-primary ring-1 ring-primary/15",
              className: "group mt-1 flex flex-col items-center justify-center rounded-[8px] px-6 py-8 text-center transition-all duration-300 relative overflow-hidden",
            }),
            isDropActive && "shadow-lg shadow-primary/10 ring-2 ring-primary/20 border-primary/30 bg-primary/[0.01]"
          )}
        >
          {isDropActive && (
            <DropZoneOverlay
              icon={Upload}
              title="松手即可添加为整理来源"
              detail="支持拖入文件夹或单个文件"
              className="inset-0 rounded-[8px]"
            />
          )}
          <motion.div
            animate={{
              y: isDropActive ? [-2, 0, -2] : 0,
            }}
            transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
            className={cn(
              "mb-3 flex h-12 w-12 items-center justify-center rounded-[8px] transition-all duration-300",
              isDropActive ? "bg-primary text-white" : "bg-on-surface/5 text-on-surface/40"
            )}
          >
            <Upload className="h-5 w-5" />
          </motion.div>
          <h3 className={cn(
            "text-[16px] font-black tracking-tight transition-colors duration-300",
            isDropActive ? "text-primary" : "text-on-surface"
          )}>
            {isDropActive ? "松手即可加入这次整理" : "请将想要整理的文件或文件夹拖放到此"}
          </h3>
          <div className={cn("mt-6 flex flex-col items-center gap-3.5 transition-opacity", isDropActive ? "opacity-20 pointer-events-none" : "opacity-100")}>
            {isDesktopEnvironment ? (
              <div className="relative flex flex-col items-center">
                <div className="flex items-stretch rounded-[8px] overflow-hidden bg-primary border border-primary/20 shadow-sm transition-all hover:shadow active:scale-[0.99]">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={onImportDirectoryEntries}
                    className="h-11 px-6 text-[14px] font-black text-white hover:bg-white/10 active:bg-white/15 transition-colors flex items-center gap-2"
                  >
                    <span>整理文件夹内容</span>
                    <Layers3 className="h-4 w-4 opacity-80" />
                  </button>
                  <div className="w-[1px] bg-white/20 my-2" />
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => onSetSourceDropdownOpen(!isSourceDropdownOpen)}
                    className="px-3 hover:bg-white/10 active:bg-white/15 transition-colors flex items-center justify-center text-white"
                  >
                    <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", isSourceDropdownOpen && "rotate-180")} />
                  </button>
                </div>

                {isSourceDropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => onSetSourceDropdownOpen(false)} />
                    <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 min-w-[200px] rounded-[8px] border border-on-surface/8 bg-surface p-1 shadow-lg animate-in fade-in slide-in-from-top-2 duration-200">
                      <button
                        type="button"
                        onClick={() => {
                          onSetSourceDropdownOpen(false);
                          onChooseDirectories();
                        }}
                        className="w-full text-left px-4 py-2.5 rounded-[6px] text-[12px] font-bold text-on-surface hover:bg-on-surface/[0.04] transition-colors flex items-center justify-between"
                      >
                        <span>移动整个文件夹</span>
                        <span className="text-[11px] text-ui-muted opacity-50 font-normal">保留外壳</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onSetSourceDropdownOpen(false);
                          onChooseFiles();
                        }}
                        className="w-full text-left px-4 py-2.5 rounded-[6px] text-[12px] font-bold text-on-surface hover:bg-on-surface/[0.04] transition-colors flex items-center justify-between"
                      >
                        <span>添加单个文件</span>
                        <span className="text-[11px] text-ui-muted opacity-50 font-normal">单个导入</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap justify-center gap-3">
                <Button
                  variant="secondary"
                  onClick={onChooseDirectories}
                  disabled={loading || !isDesktopEnvironment}
                  title={!isDesktopEnvironment ? "桌面端功能，网页模式请使用手动输入路径" : undefined}
                  className="h-9 rounded-[6px] border border-on-surface/8 bg-surface px-5 text-[12px] font-bold text-on-surface/70 hover:bg-on-surface/[0.04] hover:text-on-surface active:scale-95 transition-all"
                >
                  移动整个文件夹
                </Button>
                <Button
                  variant="secondary"
                  onClick={onChooseFiles}
                  disabled={loading || !isDesktopEnvironment}
                  title={!isDesktopEnvironment ? "桌面端功能，网页模式请使用手动输入路径" : undefined}
                  className="h-9 rounded-[6px] border border-on-surface/8 bg-surface px-5 text-[12px] font-bold text-on-surface/70 hover:bg-on-surface/[0.04] hover:text-on-surface active:scale-95 transition-all"
                >
                  添加单个文件
                </Button>
              </div>
            )}
            <p className="max-w-lg text-[11px] font-medium leading-relaxed text-ui-muted/55 text-center px-4">
              {isDesktopEnvironment
                ? "「整理文件夹内容」会分析并提取其中文件，也可移动整个文件夹或添加单个文件。"
                : "「移动整个文件夹」保留文件夹结构，「添加单个文件」只整理所选文件。"}
            </p>
            {isDesktopEnvironment && (
              <div className="rounded-[6px] border border-on-surface/6 bg-on-surface/[0.015] px-4 py-2 text-[11px] font-mono leading-relaxed text-ui-muted/50 max-w-md text-center mt-1">
                * Windows 原生限制：混选文件与文件夹请直接拖入上方区域 *
              </div>
            )}
          </div>


          <div className={cn("mt-auto pt-10 flex flex-col items-center gap-5 transition-opacity", isDropActive ? "opacity-10 pointer-events-none" : "opacity-100")}>
            {commonDirs.length ? (
              <div className="animate-in fade-in slide-in-from-bottom-2 duration-700 flex flex-col items-center">
                <div className="mb-3 flex items-center gap-3">
                  <div className="h-px w-6 bg-on-surface/5" />
                  <span className="text-[11px] font-black uppercase tracking-[0.2em] text-ui-muted/30">快捷入口</span>
                  <div className="h-px w-6 bg-on-surface/5" />
                </div>
                <div className="flex flex-wrap justify-center gap-2 max-w-2xl px-4">
                  {commonDirs.slice(0, 5).map((item) => (
                    <button
                      key={item.path}
                      type="button"
                      disabled={loading || !isDesktopEnvironment}
                      title={!isDesktopEnvironment ? "桌面端功能，网页模式请使用手动输入路径" : undefined}
                      onClick={() => onImportCommonDir(item.path)}
                      className="group flex items-center gap-2 rounded-full border border-on-surface/6 bg-on-surface/[0.015] px-3 py-1 text-[11px] font-bold text-on-surface/45 transition-all hover:border-primary/20 hover:bg-primary/[0.02] hover:text-primary active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <FolderOpen className="h-3 w-3 opacity-40 group-hover:opacity-100" />
                      <span className="truncate max-w-[100px]">{item.label || item.path.split(/[\\/]/).pop()}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => onSetShowManualInput(!showManualInput)}
              className="text-[11px] font-bold text-ui-muted opacity-25 hover:text-primary hover:opacity-100 transition-all uppercase tracking-wider"
            >
              {showManualInput ? "[ 收起手动输入 ]" : "[ 手动输入路径 ]"}
            </button>
          </div>
        </motion.div>
      ) : (
        <div ref={sourceDropZoneRef} className="mt-2 space-y-3">
          <motion.div
            animate={{
              scale: isDropActive ? 1.005 : 1,
            }}
            className={cn(
              getDropZoneSurfaceClassName({
                isActive: isDropActive,
                isDraggingGlobal,
                idleClassName: "border-on-surface/8 bg-on-surface/[0.01] hover:bg-on-surface/[0.02] border-dashed",
                draggingClassName: "border-primary/25 bg-primary/[0.01]",
                activeClassName: "border-primary/45 bg-primary/8 text-primary ring-1 ring-primary/15",
                className: "group/add-more flex flex-wrap items-center justify-between gap-3 rounded-[8px] px-3 py-1.5 text-on-surface transition-all duration-300 relative overflow-hidden",
              }),
              isDropActive && "shadow-lg shadow-primary/5 ring-1 ring-primary/10 border-primary/20 bg-primary/[0.01]"
            )}
          >
            {isDropActive && (
              <DropZoneOverlay
                icon={Plus}
                title="松手以追加整理来源"
                detail=""
                className="inset-0 rounded-[8px]"
                panelClassName="flex-row gap-2 py-0"
                iconWrapClassName="h-6 w-6 rounded-[6px]"
                titleClassName="text-[12px] font-black tracking-normal"
              />
            )}
            <div className="flex items-center gap-2 min-w-0">
              <Plus className={cn("h-4 w-4 shrink-0 transition-colors", isDropActive ? "text-primary animate-pulse" : "text-ui-muted/40 group-hover/add-more:text-primary/70")} />
              <span className={cn("text-[12px] font-bold truncate", isDropActive ? "text-primary" : "text-ui-muted opacity-55")}>
                {isDropActive ? "松手即可继续加入" : "拖入文件或文件夹以追加来源"}
              </span>
            </div>
            <div className="flex items-center gap-1 text-[11px] font-bold text-on-surface/50">
              {isDesktopEnvironment && (
                <>
                  <button
                    type="button"
                    onClick={onImportDirectoryEntries}
                    disabled={loading}
                    className="rounded px-2 py-1 text-primary hover:bg-primary/8 transition-colors disabled:opacity-40"
                  >
                    整理文件夹内容
                  </button>
                  <span className="text-on-surface/10 font-normal select-none">|</span>
                </>
              )}
              <button
                type="button"
                disabled={loading || !isDesktopEnvironment}
                title={!isDesktopEnvironment ? "桌面端功能，网页模式请使用手动输入路径" : undefined}
                onClick={onChooseDirectories}
                className="rounded px-2 py-1 hover:bg-on-surface/[0.04] hover:text-on-surface transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                移动文件夹
              </button>
              <span className="text-on-surface/10 font-normal select-none">|</span>
              <button
                type="button"
                disabled={loading || !isDesktopEnvironment}
                title={!isDesktopEnvironment ? "桌面端功能，网页模式请使用手动输入路径" : undefined}
                onClick={onChooseFiles}
                className="rounded px-2 py-1 hover:bg-on-surface/[0.04] hover:text-on-surface transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                单个文件
              </button>
              <span className="text-on-surface/10 font-normal select-none">|</span>
              <button
                type="button"
                onClick={() => onSetShowManualInput(!showManualInput)}
                className={cn("rounded px-2 py-1 transition-colors", showManualInput ? "text-primary bg-primary/5" : "hover:bg-on-surface/[0.04] hover:text-on-surface")}
              >
                手填路径
              </button>
            </div>
          </motion.div>

          <SourceListPanel
            items={listItems}
            loading={loading}
            stats={sourceStats}
            showClearConfirm={showClearConfirm}
            onClearSources={onClearSources}
            onRemoveSource={onRemoveSource}
            onImportInternal={onImportInternal}
            onSetAtomicMode={onSetAtomicMode}
            onToggleGroupExpanded={onToggleGroupExpanded}
            onRemoveGroup={onRemoveGroup}
          />
        </div>
      )}

      {showManualInput && (
        <div className="mt-4 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center gap-2 rounded-[8px] border border-on-surface/12 bg-surface-container-lowest p-1">
            <div className="flex shrink-0 rounded-[6px] border border-on-surface/5 bg-surface p-1">
              {([
                ["directory", "文件夹"],
                ["file", "文件"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onSetSourceDraftType(value)}
                  className={[
                    "rounded-[4px] px-3 py-1.5 text-[12px] font-bold transition-colors",
                    sourceDraftType === value ? "bg-primary/10 text-primary" : "text-on-surface-variant/60 hover:text-on-surface",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative flex-1">
              <input
                value={sourceDraftPath}
                onChange={(event) => onSetSourceDraftPath(event.target.value)}
                disabled={loading}
                placeholder="输入完整绝对路径..."
                className="w-full bg-transparent px-3 py-2 text-[13px] font-medium text-on-surface outline-none placeholder:text-on-surface-variant/40 focus:ring-0"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onAddManualSource();
                }}
              />
            </div>
            <button
              type="button"
              onClick={onAddManualSource}
              disabled={loading || !sourceDraftPath.trim()}
              className="shrink-0 rounded-[6px] bg-on-surface/5 px-4 py-2 text-[12px] font-bold text-on-surface transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-50"
            >
              添加
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
