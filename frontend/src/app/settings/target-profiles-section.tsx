"use client";

import type { Dispatch, SetStateAction } from "react";
import { motion, AnimatePresence } from "motion/react";
import { FolderPlus, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { targetDirectoryEditorKey, type TargetProfileDraft } from "@/app/settings/settings-draft";
import type { TargetProfile } from "@/types/session";

function extractDroppedPaths(event: React.DragEvent<HTMLElement>): string[] {
  const textPayload = event.dataTransfer.getData("text/plain");
  const uriPayload = event.dataTransfer.getData("text/uri-list");
  const files = Array.from(event.dataTransfer.files)
    .map((file) => {
      const path = (file as File & { path?: string }).path || (file as File & { webkitRelativePath?: string }).webkitRelativePath;
      return path || "";
    })
    .filter(Boolean);

  const textPaths = `${textPayload}\n${uriPayload}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => (line.startsWith("file:///") ? decodeURIComponent(line.replace(/^file:\/+/, "")) : line));

  return [...files, ...textPaths];
}

export interface TargetProfilesSectionProps {
  launchDefaultTargetProfileId: string;
  onUpdateGlobal: (key: string, value: unknown) => void;
  targetProfiles: TargetProfile[];
  targetProfilesLoading: boolean;
  targetProfileDrafts: Record<string, TargetProfileDraft>;
  selectedTargetProfileId: string;
  onSelectTargetProfile: (profileId: string) => void;
  creatingTargetProfile: boolean;
  onSetCreatingTargetProfile: (creating: boolean) => void;
  newTargetProfileName: string;
  onChangeNewTargetProfileName: (name: string) => void;
  expandedDirectoryEditors: Record<string, boolean>;
  onToggleDirectoryEditor: (editorKey: string) => void;
  dragTargetProfileId: string | null;
  setDragTargetProfileId: Dispatch<SetStateAction<string | null>>;
  registerDropZone: (profileId: string, element: HTMLDivElement | null) => void;
  onUpdateTargetProfileDraft: (profileId: string, updater: (current: TargetProfileDraft) => TargetProfileDraft) => void;
  onAddDirectories: (profileId: string, paths: string[]) => void;
  onAddDirectory: (profileId: string) => void;
  onRemoveDirectory: (profileId: string, path: string) => void;
  onCreateTargetProfile: () => void;
  onDeleteTargetProfile: (profileId: string) => void;
  onPickDirectory: () => Promise<string | null>;
}

export function TargetProfilesSection({
  launchDefaultTargetProfileId,
  onUpdateGlobal,
  targetProfiles,
  targetProfilesLoading,
  targetProfileDrafts,
  selectedTargetProfileId,
  onSelectTargetProfile,
  creatingTargetProfile,
  onSetCreatingTargetProfile,
  newTargetProfileName,
  onChangeNewTargetProfileName,
  expandedDirectoryEditors,
  onToggleDirectoryEditor,
  dragTargetProfileId,
  setDragTargetProfileId,
  registerDropZone,
  onUpdateTargetProfileDraft,
  onAddDirectories,
  onAddDirectory,
  onRemoveDirectory,
  onCreateTargetProfile,
  onDeleteTargetProfile,
  onPickDirectory,
}: TargetProfilesSectionProps) {
  const launchDefaultTargetProfile = targetProfiles.find((profile) => profile.profile_id === launchDefaultTargetProfileId) ?? null;
  const selectedTargetProfile = targetProfiles.find((profile) => profile.profile_id === selectedTargetProfileId) ?? targetProfiles[0] ?? null;
  const selectedTargetProfileDraft = selectedTargetProfile ? targetProfileDrafts[selectedTargetProfile.profile_id] : null;

  return (
    <div className="rounded-[12px] border border-on-surface/8 bg-surface px-4 py-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-semibold text-on-surface">目标目录配置</h3>
          <p className="mt-1 text-[12px] leading-5 text-on-surface-variant/65">
            “归入已有目录”会使用这里保存的目录。可以直接把文件夹拖到对应配置里添加。
          </p>
        </div>
        {targetProfilesLoading ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : null}
      </div>
      <div className="mb-4 space-y-3">
        <div className="rounded-[10px] border border-primary/12 bg-primary/[0.035] px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[12.5px] font-black text-on-surface">默认目标目录配置</h3>
              <p className="mt-1 text-[11.5px] font-medium leading-5 text-ui-muted/70">
                当“默认整理方式”为“归入已有目录”时，首页会优先选中这组目录。
              </p>
            </div>
            <select
              value={launchDefaultTargetProfileId}
              onChange={(event) => onUpdateGlobal("LAUNCH_DEFAULT_TARGET_PROFILE_ID", event.target.value)}
              disabled={targetProfilesLoading || targetProfiles.length === 0}
              className="h-9 min-w-[220px] rounded-[8px] border border-on-surface/8 bg-surface px-3 text-[12px] font-semibold text-on-surface outline-none transition-colors focus:border-primary/40 disabled:opacity-60"
            >
              <option value="">不指定默认配置</option>
              {targetProfiles.map((profile) => (
                <option key={profile.profile_id} value={profile.profile_id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </div>
          {launchDefaultTargetProfile ? (
            <p className="mt-2 text-[11px] font-medium text-primary/70">
              当前默认：{launchDefaultTargetProfile.name} · {launchDefaultTargetProfile.directories.length} 个目录
            </p>
          ) : null}
        </div>
        {/* 整合后的配置组水平管理栏 */}
        <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-on-surface/8 bg-surface-container-low p-3 w-full">
          <div className="flex flex-1 min-w-[180px] items-center gap-2 min-w-0">
            <span className="text-[12px] font-bold text-on-surface/70 shrink-0">配置组:</span>
            <select
              value={selectedTargetProfileId}
              onChange={(event) => onSelectTargetProfile(event.target.value)}
              disabled={targetProfilesLoading || targetProfiles.length === 0}
              className="h-9 flex-1 min-w-0 w-full rounded-[8px] border border-on-surface/8 bg-surface px-3 text-[12px] font-semibold text-on-surface outline-none transition-colors focus:border-primary/40 disabled:opacity-60"
            >
              {targetProfiles.length === 0 ? (
                <option value="">暂无可用配置组</option>
              ) : (
                targetProfiles.map((p) => {
                  const pDraft = targetProfileDrafts[p.profile_id];
                  return (
                    <option key={p.profile_id} value={p.profile_id}>
                      {pDraft?.name || p.name} ({pDraft?.directories.length ?? p.directories.length} 个目录)
                    </option>
                  );
                })
              )}
            </select>
          </div>

          {selectedTargetProfile && !creatingTargetProfile && (
            <div className="flex items-center gap-2 min-w-[200px] flex-1 min-w-0">
              <span className="text-[12px] font-bold text-on-surface/70 shrink-0">重命名:</span>
              <input
                value={selectedTargetProfileDraft?.name || ""}
                onChange={(event) =>
                  onUpdateTargetProfileDraft(selectedTargetProfile.profile_id, (current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                className="h-9 flex-1 min-w-0 w-full rounded-[8px] border border-on-surface/8 bg-surface px-3 text-[12px] font-semibold text-on-surface outline-none focus:border-primary/40 placeholder:text-on-surface-variant/30"
                placeholder="输入新配置名..."
              />
            </div>
          )}

          <div className="flex items-center gap-2 shrink-0 md:ml-auto">
            {!creatingTargetProfile ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  onSetCreatingTargetProfile(true);
                  onChangeNewTargetProfileName("");
                }}
                disabled={targetProfilesLoading}
                className="h-9 px-3 text-[12px] font-bold"
              >
                <FolderPlus className="mr-1.5 h-3.5 w-3.5" />
                新建组
              </Button>
            ) : (
              <div className="flex items-center gap-2 bg-primary/[0.04] border border-primary/14 rounded-[8px] p-1">
                <input
                  value={newTargetProfileName}
                  onChange={(event) => onChangeNewTargetProfileName(event.target.value)}
                  className="h-7 w-28 bg-transparent px-2 text-[12px] font-semibold text-on-surface outline-none placeholder:text-on-surface-variant/30"
                  placeholder="配置组名称"
                  autoFocus
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void onCreateTargetProfile()}
                  disabled={targetProfilesLoading || !newTargetProfileName.trim()}
                  className="h-7 px-2.5 text-[11px] font-bold"
                >
                  确定
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onSetCreatingTargetProfile(false)}
                  className="h-7 px-2.5 text-[11px] font-bold text-ui-muted"
                >
                  取消
                </Button>
              </div>
            )}

            {selectedTargetProfile && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => void onDeleteTargetProfile(selectedTargetProfile.profile_id)}
                disabled={targetProfilesLoading}
                className="h-9 px-3 text-[12px] font-bold text-error hover:bg-error/10 hover:text-error"
              >
                删除当前组
              </Button>
            )}
          </div>
        </div>
      </div>
      <div className="grid gap-3">
        {selectedTargetProfile ? (() => {
          const profile = selectedTargetProfile;
          const profileDraft = targetProfileDrafts[profile.profile_id] ?? {
            name: profile.name,
            directories: profile.directories,
            newPath: "",
            newLabel: "",
            newDescription: "",
          };
          const dragActive = dragTargetProfileId === profile.profile_id;
          return (
            <div
              key={profile.profile_id}
              ref={(element) => {
                registerDropZone(profile.profile_id, element);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                setDragTargetProfileId(profile.profile_id);
              }}
              onDragLeave={() => setDragTargetProfileId((current) => (current === profile.profile_id ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                setDragTargetProfileId(null);
                onAddDirectories(profile.profile_id, extractDroppedPaths(event));
              }}
              className={cn(
                "relative overflow-hidden rounded-[12px] border px-4 py-4 transition-all duration-200",
                dragActive
                  ? "border-primary bg-primary/[0.04] ring-2 ring-primary/20 shadow-md"
                  : "border-on-surface/8 bg-surface-container-lowest",
              )}
            >
              {/* 拖入文件夹时的半透明蓝色遮罩与动画 */}
              <AnimatePresence>
                {dragActive && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-primary/10 backdrop-blur-[1px] pointer-events-none"
                  >
                    <motion.div
                      initial={{ scale: 0.9, y: 10 }}
                      animate={{ scale: 1, y: 0 }}
                      exit={{ scale: 0.9, y: 10 }}
                      className="flex flex-col items-center gap-2 rounded-xl border border-primary/20 bg-surface px-6 py-5 shadow-lg"
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <FolderPlus className="h-6 w-6 animate-pulse" />
                      </div>
                      <p className="text-sm font-bold text-on-surface">释放以将文件夹导入当前配置</p>
                      <p className="text-[11px] text-ui-muted">可一次拖入多个文件夹路径</p>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* 操作区 (拖拽提示框 + 手动添加表单) */}
              <div className="space-y-3 pb-4 border-b border-on-surface/6">
                {/* 拖拽提示框，更现代的虚线引导框 */}
                <div className="flex items-center gap-2.5 rounded-[8px] border border-dashed border-primary/20 bg-primary/[0.015] px-3.5 py-3 text-[11.5px] font-semibold text-ui-muted hover:bg-primary/[0.03] transition-colors">
                  <FolderPlus className="h-4 w-4 text-primary/65 shrink-0" />
                  <span>支持直接将文件夹拖拽至当前面板内任何位置，自动解析并添加路径。</span>
                </div>

                {/* 紧密排列的手动添加表单 */}
                <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_130px_180px_auto]">
                  <div className="relative flex items-center">
                    <input
                      value={profileDraft.newPath}
                      onChange={(event) => onUpdateTargetProfileDraft(profile.profile_id, (current) => ({ ...current, newPath: event.target.value }))}
                      className="h-9 w-full rounded-[8px] border border-on-surface/8 bg-surface pl-3 pr-16 font-mono text-[12px] text-on-surface outline-none transition-colors focus:border-primary/40 placeholder:text-on-surface-variant/35"
                      placeholder="目标目录完整路径"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        void (async () => {
                          const selected = await onPickDirectory();
                          if (selected) {
                            onUpdateTargetProfileDraft(profile.profile_id, (current) => ({ ...current, newPath: selected }));
                          }
                        })();
                      }}
                      className="absolute right-1.5 h-6 rounded-[4px] border border-on-surface/10 bg-surface px-2.5 py-0.5 text-[11px] font-bold text-on-surface transition-colors hover:border-primary/20 hover:text-primary active:scale-95"
                    >
                      浏览...
                    </button>
                  </div>
                  <input
                    value={profileDraft.newLabel}
                    onChange={(event) => onUpdateTargetProfileDraft(profile.profile_id, (current) => ({ ...current, newLabel: event.target.value }))}
                    className="h-9 rounded-[8px] border border-on-surface/8 bg-surface px-3 text-[12px] text-on-surface outline-none transition-colors focus:border-primary/40"
                    placeholder="标签（可选）"
                  />
                  <input
                    value={profileDraft.newDescription}
                    onChange={(event) => onUpdateTargetProfileDraft(profile.profile_id, (current) => ({ ...current, newDescription: event.target.value }))}
                    className="h-9 rounded-[8px] border border-on-surface/8 bg-surface px-3 text-[12px] text-on-surface outline-none transition-colors focus:border-primary/40"
                    placeholder="目录说明（可选）"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => onAddDirectory(profile.profile_id)}
                    disabled={targetProfilesLoading || !profileDraft.newPath.trim()}
                    className="h-9 px-4 text-[12px] font-bold"
                  >
                    添加目录
                  </Button>
                </div>
              </div>

              {/* 已添加目录的列表 - 限高与纵向滚动 */}
              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider text-ui-muted">已配置目录 ({profileDraft.directories.length})</h4>
                </div>

                <div className="max-h-[360px] overflow-y-auto pr-1 space-y-1.5 scrollbar-thin">
                  {profileDraft.directories.length ? profileDraft.directories.map((directory) => (
                    <div
                      key={directory.path}
                      className="group relative flex items-center justify-between gap-3 rounded-[8px] border border-on-surface/8 bg-surface px-3 py-2 transition-all hover:border-on-surface/16 hover:bg-on-surface/[0.015]"
                    >
                      {(() => {
                        const editorKey = targetDirectoryEditorKey(profile.profile_id, directory.path);
                        const isExpanded = expandedDirectoryEditors[editorKey] ?? false;
                        return (
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              {directory.label ? (
                                <span className="shrink-0 rounded-[4px] bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                                  {directory.label}
                                </span>
                              ) : null}
                              <span className="text-[12px] font-bold text-on-surface truncate">
                                {directory.path.split(/[\\/]/).pop() || directory.path}
                              </span>
                              <span className="font-mono text-[10.5px] text-ui-muted/50 truncate max-w-[280px]" title={directory.path}>
                                {directory.path}
                              </span>
                            </div>

                            {directory.description && (
                              <p className="mt-0.5 text-[11px] leading-relaxed text-ui-muted/75 truncate">
                                {directory.description}
                              </p>
                            )}

                            {isExpanded && (
                              <div className="mt-2.5 grid gap-2 border-t border-on-surface/6 pt-2 xl:grid-cols-[180px_minmax(0,1fr)]">
                                <input
                                  value={directory.label || ""}
                                  onChange={(event) =>
                                    onUpdateTargetProfileDraft(profile.profile_id, (current) => ({
                                      ...current,
                                      directories: current.directories.map((item) => (
                                        item.path === directory.path
                                          ? { ...item, label: event.target.value }
                                          : item
                                      )),
                                    }))
                                  }
                                  className="h-8 rounded-[6px] border border-on-surface/8 bg-surface-container-lowest px-2.5 text-[11px] text-on-surface outline-none transition-colors focus:border-primary/40"
                                  placeholder="标签（可选）"
                                />
                                <input
                                  value={directory.description || ""}
                                  onChange={(event) =>
                                    onUpdateTargetProfileDraft(profile.profile_id, (current) => ({
                                      ...current,
                                      directories: current.directories.map((item) => (
                                        item.path === directory.path
                                          ? { ...item, description: event.target.value }
                                          : item
                                      )),
                                    }))
                                  }
                                  className="h-8 rounded-[6px] border border-on-surface/8 bg-surface-container-lowest px-2.5 text-[11px] text-on-surface outline-none transition-colors focus:border-primary/40"
                                  placeholder="目录说明（可选）"
                                />
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      <div className="flex shrink-0 items-center gap-1.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity duration-150">
                        <button
                          type="button"
                          onClick={() => onToggleDirectoryEditor(targetDirectoryEditorKey(profile.profile_id, directory.path))}
                          disabled={targetProfilesLoading}
                          className={cn(
                            "rounded-[6px] px-2 py-1 text-[11px] font-bold transition-colors disabled:opacity-50",
                            expandedDirectoryEditors[targetDirectoryEditorKey(profile.profile_id, directory.path)]
                              ? "bg-primary/10 text-primary"
                              : "text-primary hover:bg-primary/5"
                          )}
                        >
                          {expandedDirectoryEditors[targetDirectoryEditorKey(profile.profile_id, directory.path)] ? "收起编辑" : "编辑"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveDirectory(profile.profile_id, directory.path)}
                          disabled={targetProfilesLoading}
                          className="rounded-[6px] px-2 py-1 text-[11px] font-bold text-error transition-colors hover:bg-error/5 disabled:opacity-50"
                        >
                          移除
                        </button>
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-[8px] border border-dashed border-on-surface/10 bg-surface px-3 py-6 text-center text-[12px] font-medium text-ui-muted">
                      当前配置中还没有添加任何目录。
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })() : (
          <div className="rounded-[12px] border border-dashed border-on-surface/10 bg-surface-container-lowest px-4 py-6 text-center text-[13px] font-medium text-ui-muted">
            还没有目标目录配置。新建一个配置后，在启动页选择“归入现有目录”即可复用。
          </div>
        )}
      </div>
    </div>
  );
}
