"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BookOpenCheck,
  Check,
  ChevronDown,
  FolderInput,
  HelpCircle,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Undo2,
  X,
  Zap,
} from "lucide-react";

import { createApiClient } from "@/lib/api";
import { rememberActiveWorkspaceRoute } from "@/lib/app-context-store";
import { getPathBasename } from "@/lib/path-normalization";
import { getApiBaseUrl, getApiToken } from "@/lib/runtime";
import { localizeUserFacingError } from "@/lib/user-facing-copy";
import { buildWorkspaceRoute } from "@/lib/workspace-routes";
import type { TargetProfile } from "@/types/session";

const SOURCE_STORAGE_KEY = "filepilot.one_click_source_path";
const SELECTED_PROFILE_KEY = "filepilot.one_click_selected_profile_id";

function loadStoredSource(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(SOURCE_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function storeSource(path: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SOURCE_STORAGE_KEY, path);
  } catch {
    // 静默降级
  }
}

function loadStoredProfileId(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(SELECTED_PROFILE_KEY) || "";
  } catch {
    return "";
  }
}

function storeProfileId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SELECTED_PROFILE_KEY, id);
  } catch {
    // 静默降级
  }
}

function isRuleComplete(profile: TargetProfile): boolean {
  return (
    profile.directories.length > 0 &&
    profile.directories.every((item) => String(item.description || "").trim())
  );
}

export function OneClickPanel() {
  const router = useRouter();
  const api = useMemo(() => createApiClient(getApiBaseUrl(), getApiToken()), []);
  const [profiles, setProfiles] = useState<TargetProfile[] | null>(null);
  const [sourcePath, setSourcePath] = useState<string>("");
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHelpCard, setShowHelpCard] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSourcePath(loadStoredSource());
    let cancelled = false;
    void api
      .getTargetProfiles()
      .then((items) => {
        if (cancelled) return;
        setProfiles(items);
        const complete = items.filter(isRuleComplete);
        if (complete.length > 0) {
          const storedId = loadStoredProfileId();
          const exists = complete.some((p) => p.profile_id === storedId);
          setSelectedProfileId(exists ? storedId : complete[0].profile_id);
        }
      })
      .catch(() => {
        if (!cancelled) setProfiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  // 点击外部收起下拉菜单
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    if (isDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isDropdownOpen]);

  const completeProfiles = useMemo(
    () => (profiles || []).filter(isRuleComplete),
    [profiles],
  );

  const selectedProfile = useMemo(
    () => completeProfiles.find((p) => p.profile_id === selectedProfileId) || completeProfiles[0] || null,
    [completeProfiles, selectedProfileId],
  );

  const handlePickSource = useCallback(async () => {
    try {
      const result = await api.selectDir();
      if (result.path) {
        setSourcePath(result.path as string);
        storeSource(result.path as string);
      }
    } catch {
      setError("打开目录选择器失败，请重试。");
    }
  }, [api]);

  const handleSelectProfile = useCallback((id: string) => {
    setSelectedProfileId(id);
    storeProfileId(id);
    setIsDropdownOpen(false);
  }, []);

  const handleLaunch = useCallback(async () => {
    if (!selectedProfile || !sourcePath.trim()) return;
    setLaunching(true);
    setError(null);
    try {
      const response = await api.createSession({
        sources: [{ source_type: "directory", path: sourcePath.trim() }],
        resume_if_exists: false,
        organize_method: "assign_into_existing_categories",
        unattended: true,
        target_profile_id: selectedProfile.profile_id,
        target_directory_details: selectedProfile.directories,
      });
      if (!response.session_id) {
        throw new Error("没有成功创建一键整理会话，请再试一次。");
      }
      const route = buildWorkspaceRoute("progress", {
        sessionId: response.session_id,
        dir: sourcePath.trim(),
        autoScan: true,
      });
      rememberActiveWorkspaceRoute(route);
      router.push(route);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("TARGET_RULES_INCOMPLETE")) {
        setError("这组目录还有规则没写完，请先到「分类规则」补全。");
      } else if (message.includes("SESSION_LOCKED")) {
        setError("该目录已有正在进行的整理任务，请先处理或放弃它。");
      } else {
        setError(localizeUserFacingError(err, "启动一键整理失败，请再试一次。"));
      }
    } finally {
      setLaunching(false);
    }
  }, [api, router, selectedProfile, sourcePath]);

  if (profiles === null) {
    return null;
  }

  if (completeProfiles.length === 0) {
    return (
      <div className="rounded-[12px] border border-dashed border-on-surface/12 bg-surface-container-lowest/60 px-4 py-3.5 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BookOpenCheck className="h-4 w-4" aria-hidden />
          </div>
          <div className="flex flex-col">
            <p className="text-[13px] font-black text-on-surface">
              {profiles.length === 0 ? "先建立你的目录规则，就能一键整理" : "补全目录规则后即可一键整理"}
            </p>
            <p className="text-[12px] font-medium text-on-surface-variant/60">
              为每个目标目录设定匹配条件，AI 自动判定分类，非目标文件留在原地。
            </p>
          </div>
          <Link
            href="/rules"
            className="ml-auto shrink-0 rounded-lg bg-primary px-3.5 py-1.5 text-[12px] font-bold text-on-primary shadow-sm transition-all hover:bg-primary/90 active:scale-95"
          >
            去写规则
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="relative rounded-2xl border border-on-surface/8 bg-surface-container-lowest p-3.5 shadow-sm transition-all hover:border-on-surface/15 sm:p-4">
      {/* 头部标题与辅助说明 */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-on-surface/5 pb-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Zap className="h-3.5 w-3.5 fill-primary/20" aria-hidden />
          </div>
          <h2 className="text-[13px] font-black tracking-tight text-on-surface">一键整理</h2>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
            免确认全自动
          </span>
          <span className="text-[11px] font-medium text-on-surface-variant/60 hidden sm:inline">
            按规则自动分类归档，未匹配与不确定项安全留原地
          </span>
        </div>

        <button
          type="button"
          onClick={() => setShowHelpCard((prev) => !prev)}
          title="一键整理功能说明"
          className="group flex items-center gap-1 text-[11px] font-semibold text-on-surface-variant/60 hover:text-primary transition-colors focus:outline-none"
        >
          <HelpCircle className="h-3.5 w-3.5 transition-transform group-hover:scale-110" aria-hidden />
          <span>规则说明</span>
        </button>
      </div>

      {/* 功能说明展开卡片 */}
      {showHelpCard ? (
        <div className="mb-3 relative rounded-xl border border-primary/20 bg-surface-container/50 p-3 shadow-inner backdrop-blur-sm animate-in fade-in-50 zoom-in-95 space-y-2.5">
          <div className="flex items-center justify-between pb-2 border-b border-on-surface/8">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Sparkles className="h-3.5 w-3.5 fill-primary/20" />
              </div>
              <h3 className="text-[13px] font-black text-on-surface">什么是「一键整理」？</h3>
            </div>
            <button
              type="button"
              onClick={() => setShowHelpCard(false)}
              className="rounded-lg p-1 text-on-surface-variant/50 hover:bg-on-surface/8 hover:text-on-surface transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[12px]">
            <div className="rounded-lg bg-surface-container-lowest/80 p-2.5 border border-on-surface/6 space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-on-surface">
                <Zap className="h-3.5 w-3.5 text-primary shrink-0" />
                <span>按规则自动归类</span>
              </div>
              <p className="text-[11px] font-medium text-on-surface-variant/70 leading-relaxed">
                根据您选择的【目标规则】，AI 会自动将符合条件的文件分门别类移动到对应文件夹中。
              </p>
            </div>

            <div className="rounded-lg bg-surface-container-lowest/80 p-2.5 border border-on-surface/6 space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-on-surface">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                <span>未匹配文件安全留原地</span>
              </div>
              <p className="text-[11px] font-medium text-on-surface-variant/70 leading-relaxed">
                不符合规则或不确定的文件（如临时草稿、未定分类文件）会安全保留在原文件夹，绝不误动。
              </p>
            </div>

            <div className="rounded-lg bg-surface-container-lowest/80 p-2.5 border border-on-surface/6 space-y-1">
              <div className="flex items-center gap-1.5 font-bold text-on-surface">
                <Undo2 className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                <span>支持随时一键还原</span>
              </div>
              <p className="text-[11px] font-medium text-on-surface-variant/70 leading-relaxed">
                整理记录自动保存。如果对整理结果不满意，可在【整理历史】中随时一键完整还原文件。
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* 错误提示 */}
      {error ? (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-[12px] font-semibold text-error">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="flex-1">{error}</span>
          {error.includes("分类规则") ? (
            <Link href="/rules" className="ml-auto shrink-0 font-bold text-primary hover:underline">
              打开分类规则
            </Link>
          ) : null}
        </div>
      ) : null}

      {/* 核心流水线控制区 */}
      <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-on-surface/6 bg-surface/50 p-2 sm:p-2.5">
        {/* 来源目录选择 */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black uppercase tracking-wider text-on-surface-variant/40 shrink-0">
            来源
          </span>
          <button
            type="button"
            onClick={() => void handlePickSource()}
            title={sourcePath || "点击选择要整理的源文件夹"}
            className="group flex max-w-[210px] sm:max-w-[240px] items-center gap-2 rounded-lg border border-on-surface/10 bg-surface-container-lowest px-3 py-1.5 text-left text-[12px] font-bold text-on-surface shadow-2xs transition-all hover:border-primary/40 hover:bg-surface-container-lowest/80 active:scale-[0.98]"
          >
            <FolderInput className="h-4 w-4 shrink-0 text-primary/70 transition-colors group-hover:text-primary" aria-hidden />
            <span className="truncate">
              {sourcePath ? getPathBasename(sourcePath, sourcePath) : "选择目录"}
            </span>
            <span className="shrink-0 text-[10px] font-semibold text-on-surface-variant/40 group-hover:text-primary/70">更改</span>
          </button>
        </div>

        {/* 流程连接指示 */}
        <div className="flex items-center gap-1 text-on-surface-variant/35 px-0.5">
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          <span className="text-[10px] font-bold text-on-surface-variant/40 hidden md:inline">归类至</span>
        </div>

        {/* 分类目标规则选择 */}
        <div className="flex flex-1 min-w-[200px] flex-wrap items-center gap-2" ref={dropdownRef}>
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsDropdownOpen((prev) => !prev)}
              className="flex items-center gap-2 rounded-lg border border-on-surface/10 bg-surface-container-lowest px-3 py-1.5 text-left text-[12px] font-bold text-on-surface shadow-2xs transition-all hover:border-primary/40 hover:bg-surface-container-lowest/80 active:scale-[0.98]"
            >
              <span className="text-[11px] font-medium text-on-surface-variant/50">规则:</span>
              <span className="max-w-[120px] truncate font-bold text-on-surface">
                {selectedProfile?.name || "未选择"}
              </span>
              <span className="rounded-full bg-primary/10 px-1.5 py-0.2 text-[10px] font-black text-primary">
                {selectedProfile?.directories.length || 0}目录
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-on-surface-variant/50 transition-transform ${
                  isDropdownOpen ? "rotate-180" : ""
                }`}
                aria-hidden
              />
            </button>

            {/* 下拉浮动菜单 (Dropdown Popover) */}
            {isDropdownOpen ? (
              <div className="absolute left-0 top-full z-50 mt-1.5 w-[280px] rounded-xl border border-on-surface/12 bg-surface-container-lowest p-1.5 shadow-xl backdrop-blur-md animate-in fade-in-50 zoom-in-95">
                <div className="px-2 py-1.5 text-[10px] font-black uppercase tracking-wider text-on-surface-variant/50 border-b border-on-surface/6 mb-1">
                  选择分类目标规则
                </div>
                <div className="max-h-[220px] space-y-0.5 overflow-y-auto scrollbar-thin">
                  {completeProfiles.map((p) => {
                    const isSelected = p.profile_id === selectedProfile?.profile_id;
                    const previewNames = p.directories
                      .slice(0, 3)
                      .map((d) => d.label || d.path.split(/[/\\]/).at(-1) || d.path)
                      .join(" / ");
                    return (
                      <button
                        key={p.profile_id}
                        type="button"
                        onClick={() => handleSelectProfile(p.profile_id)}
                        className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition-all ${
                          isSelected
                            ? "bg-primary/10 text-primary font-bold"
                            : "text-on-surface hover:bg-on-surface/5"
                        }`}
                      >
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-[12px] font-bold">{p.name}</span>
                            <span className="shrink-0 rounded-full bg-on-surface/8 px-1.5 py-0.2 text-[10px] font-semibold text-on-surface-variant/60">
                              {p.directories.length}分类
                            </span>
                          </div>
                          {previewNames ? (
                            <span className="truncate text-[10px] text-on-surface-variant/50">
                              {previewNames}{p.directories.length > 3 ? "..." : ""}
                            </span>
                          ) : null}
                        </div>
                        {isSelected ? <Check className="h-4 w-4 shrink-0 text-primary ml-2" /> : null}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1.5 border-t border-on-surface/8 pt-1">
                  <Link
                    href="/rules"
                    onClick={() => setIsDropdownOpen(false)}
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-primary hover:bg-primary/5 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>管理 / 新建规则组</span>
                  </Link>
                </div>
              </div>
            ) : null}
          </div>

          {/* 外显目标分类标签预览 (消除中间空白与盲盒感) */}
          {selectedProfile && selectedProfile.directories.length > 0 ? (
            <div className="hidden items-center gap-1.5 lg:flex">
              <div className="flex items-center gap-1">
                {selectedProfile.directories.slice(0, 3).map((d) => {
                  const label = d.label || d.path.split(/[/\\]/).at(-1) || d.path;
                  return (
                    <span
                      key={d.path}
                      title={d.path}
                      className="inline-flex max-w-[110px] truncate items-center rounded-md border border-on-surface/8 bg-surface-container-lowest px-2 py-0.5 text-[11px] font-medium text-on-surface-variant/75 shadow-2xs"
                    >
                      {label}
                    </span>
                  );
                })}
              </div>
              {selectedProfile.directories.length > 3 ? (
                <span className="text-[10px] font-bold text-on-surface-variant/40">
                  +{selectedProfile.directories.length - 3}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* 触发一键整理主按钮 */}
        <button
          type="button"
          onClick={() => void handleLaunch()}
          disabled={!sourcePath.trim() || !selectedProfile || launching}
          className="group relative ml-auto flex items-center gap-1.5 rounded-lg border border-primary/20 bg-gradient-to-r from-primary via-[color-mix(in_srgb,var(--primary)_94%,white)] to-primary px-3.5 py-1.5 text-[12px] font-bold text-white shadow-[0_2px_8px_rgba(0,120,212,0.2),inset_0_1px_0_rgba(255,255,255,0.25)] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_4px_14px_rgba(0,120,212,0.32)] active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:translate-y-0"
        >
          {launching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-white" aria-hidden />
          ) : (
            <Zap className="h-3.5 w-3.5 text-white/90 transition-transform duration-200 group-hover:scale-110 group-hover:text-white" aria-hidden />
          )}
          <span className="tracking-wide">{launching ? "正在开启..." : "一键整理"}</span>
        </button>
      </div>
    </div>
  );
}
