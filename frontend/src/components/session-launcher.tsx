"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  FolderOpen,
  History,
  Layers3,
  Sparkles,
  X,
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { motion, AnimatePresence } from "motion/react";

import { createApiClient } from "@/lib/api";
import { startFreshSession } from "@/lib/session-launcher-actions";
import { getApiBaseUrl } from "@/lib/runtime";
import {
  CAUTION_LEVEL_OPTIONS,
  DEFAULT_STRATEGY_SELECTION,
  getSuggestedSelection,
  getTemplateMeta,
  NAMING_STYLE_OPTIONS,
  STRATEGY_TEMPLATES,
} from "@/lib/strategy-templates";
import { SessionSnapshot, SessionStrategySelection, SessionStrategySummary } from "@/types/session";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const STAGE_LABELS: Record<string, string> = {
  idle: "空闲挂起",
  draft: "草案生成中",
  scanning: "正在分析目录",
  planning: "架构方案构思中",
  ready_for_precheck: "等待冲突预检",
  ready_to_execute: "等待执行确认",
  executing: "正在执行整理",
  completed: "整理任务已完成",
  rolling_back: "正在回退架构",
  abandoned: "已放弃",
  stale: "会话已失效 (目录内容变化)",
  interrupted: "任务已中断",
};

const DEFAULT_STRATEGY_SUMMARY: SessionStrategySummary = {
  ...DEFAULT_STRATEGY_SELECTION,
  template_label: "通用下载",
  template_description: "适合下载目录、桌面暂存区等混合文件场景。",
  naming_style_label: "中文目录",
  caution_level_label: "平衡",
  preview_directories: ["项目资料", "财务票据", "学习资料", "安装程序", "待确认"],
};

function StrategySummaryChips({ strategy }: { strategy: SessionStrategySummary }) {
  return (
    <div className="flex flex-wrap gap-2">
      <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">{strategy.template_label}</span>
      <span className="rounded-full border border-on-surface/8 bg-white px-3 py-1 text-xs font-medium text-on-surface-variant">
        {strategy.naming_style_label}
      </span>
      <span className="rounded-full border border-on-surface/8 bg-white px-3 py-1 text-xs font-medium text-on-surface-variant">
        {strategy.caution_level_label}
      </span>
      {strategy.note ? (
        <span className="rounded-full bg-warning-container/20 px-3 py-1 text-xs font-medium text-on-surface-variant">
          偏好：{strategy.note}
        </span>
      ) : null}
    </div>
  );
}

function StrategyDialog({
  open,
  loading,
  targetDir,
  strategy,
  onClose,
  onConfirm,
  onTemplateSelect,
  onChangeNaming,
  onChangeCaution,
  onChangeNote,
}: {
  open: boolean;
  loading: boolean;
  targetDir: string;
  strategy: SessionStrategySelection;
  onClose: () => void;
  onConfirm: () => void;
  onTemplateSelect: (templateId: SessionStrategySelection["template_id"]) => void;
  onChangeNaming: (id: SessionStrategySelection["naming_style"]) => void;
  onChangeCaution: (id: SessionStrategySelection["caution_level"]) => void;
  onChangeNote: (value: string) => void;
}) {
  const currentTemplate = useMemo(() => getTemplateMeta(strategy.template_id), [strategy.template_id]);
  const previewDirectories = currentTemplate.previewDirectories[strategy.naming_style] || [];
  const namingLabel = NAMING_STYLE_OPTIONS.find((item) => item.id === strategy.naming_style)?.label || "中文目录";
  const cautionLabel = CAUTION_LEVEL_OPTIONS.find((item) => item.id === strategy.caution_level)?.label || "平衡";

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface/70 px-6 py-8 backdrop-blur-md">
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 20 }}
            className="flex h-[min(86vh,920px)] w-full max-w-6xl flex-col overflow-hidden rounded-[34px] border border-outline-variant/12 bg-white/92 shadow-[0_28px_100px_rgba(36,48,42,0.16)]"
          >
            <div className="flex shrink-0 items-start justify-between gap-6 border-b border-on-surface/6 px-8 py-6">
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/10 bg-primary/8 px-3 py-1 text-xs font-medium text-primary">
                  <Layers3 className="h-3.5 w-3.5" />
                  整理策略
                </div>
                <div className="space-y-2">
                  <h2 className="text-3xl font-black font-headline tracking-tight text-on-surface">配置这次整理规则</h2>
                  <p className="max-w-2xl text-[15px] leading-7 text-on-surface-variant">
                    这里决定本次会话的分类方式、目录命名风格和保守程度。确认后才真正开始扫描。
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="hidden rounded-[22px] border border-on-surface/8 bg-surface-container-low/35 px-5 py-4 lg:block">
                  <div className="text-xs font-medium text-on-surface-variant/70">当前目录</div>
                  <p className="mt-2 max-w-[320px] break-all text-sm font-medium text-on-surface">{targetDir}</p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full border border-on-surface/8 bg-white p-2.5 text-on-surface-variant transition-colors hover:text-on-surface hover:bg-surface-container-low"
                  title="关闭"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
              <div className="grid gap-6 xl:grid-cols-[240px_minmax(0,1fr)]">
                <div className="space-y-2">
                  {STRATEGY_TEMPLATES.map((template) => {
                    const active = strategy.template_id === template.id;
                    return (
                      <button
                        key={template.id}
                        type="button"
                        disabled={loading}
                        onClick={() => onTemplateSelect(template.id)}
                        className={cn(
                          "w-full rounded-[22px] border px-4 py-4 text-left transition-all disabled:opacity-50",
                          active
                            ? "border-primary/15 bg-white text-on-surface shadow-sm"
                            : "border-transparent bg-surface-container-low/45 text-on-surface-variant hover:border-on-surface/8 hover:bg-white/70",
                        )}
                      >
                        <p className="text-sm font-bold">{template.label}</p>
                        <p className="mt-1 text-xs leading-5 opacity-80">{template.description}</p>
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-5">
                  <div className="rounded-[32px] border border-on-surface/6 bg-white/80 p-8">
                    <div className="grid gap-8 lg:grid-cols-[1.18fr_0.82fr]">
                      <div className="space-y-5">
                        <div className="space-y-3">
                          <div className="text-xs font-medium text-on-surface-variant/70">整理结果预览</div>
                          <p className="text-4xl font-black font-headline tracking-tight text-on-surface">{currentTemplate.label}</p>
                          <p className="max-w-xl text-[15px] leading-8 text-on-surface-variant">{currentTemplate.description}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">{namingLabel}</span>
                          <span className="rounded-full bg-surface-container px-3 py-1 text-xs font-medium text-on-surface-variant">{cautionLabel}</span>
                        </div>
                        <p className="max-w-lg text-sm leading-7 text-on-surface-variant">
                          当前模板会优先决定如何分组目录、目录名偏什么风格，以及不确定项是更保守地进入待确认区，还是尽量自动归类。
                        </p>
                      </div>

                      <div className="space-y-3 border-t border-on-surface/6 pt-5 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0">
                        <div className="text-xs font-medium text-on-surface-variant/70">建议目录示例</div>
                        {previewDirectories.map((directory, index) => (
                          <div
                            key={`${strategy.template_id}-${strategy.naming_style}-${directory}`}
                            className="flex items-center justify-between border-b border-on-surface/6 py-3 first:pt-0 last:border-b-0 last:pb-0"
                          >
                            <span className="font-mono text-sm text-on-surface-variant/55">/{String(index + 1).padStart(2, "0")}</span>
                            <span className="text-sm font-bold text-on-surface">{directory}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-5 lg:grid-cols-2">
                    <div className="rounded-[26px] border border-on-surface/6 bg-white/68 p-6">
                      <div className="mb-4 text-xs font-medium text-on-surface-variant/70">目录命名风格</div>
                      <div className="space-y-2">
                        {NAMING_STYLE_OPTIONS.map((option) => {
                          const active = strategy.naming_style === option.id;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              disabled={loading}
                              onClick={() => onChangeNaming(option.id)}
                              className={cn(
                                "w-full rounded-[18px] border px-4 py-3 text-left transition-all disabled:opacity-50",
                                active ? "border-primary/15 bg-primary/5" : "border-transparent bg-surface-container-low/50 hover:border-on-surface/8",
                              )}
                            >
                              <p className="text-sm font-bold text-on-surface">{option.label}</p>
                              <p className="mt-1 text-[13px] leading-6 text-on-surface-variant">{option.description}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-[26px] border border-on-surface/6 bg-white/68 p-6">
                      <div className="mb-4 text-xs font-medium text-on-surface-variant/70">整理保守度</div>
                      <div className="space-y-2">
                        {CAUTION_LEVEL_OPTIONS.map((option) => {
                          const active = strategy.caution_level === option.id;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              disabled={loading}
                              onClick={() => onChangeCaution(option.id)}
                              className={cn(
                                "w-full rounded-[18px] border px-4 py-3 text-left transition-all disabled:opacity-50",
                                active ? "border-primary/15 bg-primary/5" : "border-transparent bg-surface-container-low/50 hover:border-on-surface/8",
                              )}
                            >
                              <p className="text-sm font-bold text-on-surface">{option.label}</p>
                              <p className="mt-1 text-[13px] leading-6 text-on-surface-variant">{option.description}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[26px] border border-on-surface/6 bg-white/68 p-6">
                    <div className="mb-4 text-xs font-medium text-on-surface-variant/70">补充说明</div>
                    <textarea
                      value={strategy.note}
                      disabled={loading}
                      onChange={(event) => onChangeNote(event.target.value.slice(0, 200))}
                      placeholder="例如：项目相关文件尽量集中；拿不准的都先放待确认。"
                      className="min-h-[148px] w-full rounded-[22px] border border-on-surface/8 bg-surface-container-low/25 px-4 py-3 text-sm leading-7 text-on-surface outline-none transition-all placeholder:text-outline-variant/60 focus:border-primary/30 focus:ring-2 focus:ring-primary/10 disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="shrink-0 border-t border-on-surface/6 bg-white/92 px-8 py-5 backdrop-blur-sm">
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-on-surface/6 bg-surface/72 px-5 py-4">
                <div className="space-y-1">
                  <p className="text-sm font-bold text-on-surface">当前配置</p>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">{currentTemplate.label}</span>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-on-surface-variant border border-on-surface/8">{namingLabel}</span>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-on-surface-variant border border-on-surface/8">{cautionLabel}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-[18px] border border-on-surface/10 px-5 py-3 text-sm font-medium text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={onConfirm}
                    disabled={loading}
                    className="rounded-[18px] bg-primary px-6 py-3 text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-[0.98] disabled:opacity-50 disabled:scale-100 flex items-center gap-2"
                  >
                    {loading ? "创建中" : "确认策略并开始扫描"}
                    {!loading && <ArrowRight className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

export function SessionLauncher() {
  const router = useRouter();
  const apiBaseUrl = getApiBaseUrl();
  const [targetDir, setTargetDir] = useState("");
  const [strategyDialogOpen, setStrategyDialogOpen] = useState(false);
  const [strategy, setStrategy] = useState<SessionStrategySelection>(DEFAULT_STRATEGY_SELECTION);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumePrompt, setResumePrompt] = useState<{ sessionId: string; snapshot: SessionSnapshot } | null>(null);

  const resumeStrategy = resumePrompt?.snapshot.strategy || DEFAULT_STRATEGY_SUMMARY;

  async function handleSelectDir() {
    setLoading(true);
    setError(null);
    try {
      const api = createApiClient(apiBaseUrl);
      const res = await api.selectDir();
      if (res.path) {
        setTargetDir(res.path);
      }
    } catch (_err) {
      setError("无法调用文件夹选择器，请检查后端运行状态。");
    } finally {
      setLoading(false);
    }
  }

  function openStrategyDialog() {
    if (!targetDir.trim()) {
      setError("请先选择一个需要整理的目录。");
      return;
    }
    setError(null);
    setStrategyDialogOpen(true);
  }

  function handleTemplateSelect(templateId: SessionStrategySelection["template_id"]) {
    const suggested = getSuggestedSelection(templateId);
    setStrategy((prev) => ({
      ...prev,
      template_id: templateId,
      naming_style: suggested.naming_style,
      caution_level: suggested.caution_level,
    }));
  }

  async function handleLaunch() {
    if (!targetDir.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const api = createApiClient(apiBaseUrl);
      const response = await api.createSession(targetDir, true, strategy);
      if (response.mode === "resume_available" && response.restorable_session?.session_id) {
        setResumePrompt({
          sessionId: response.restorable_session.session_id,
          snapshot: response.restorable_session,
        });
        return;
      }
      if (!response.session_id) {
        throw new Error("初始化失败：后端未返回有效的访问 ID");
      }
      router.push(`/workspace?session_id=${response.session_id}&dir=${encodeURIComponent(targetDir)}`);
    } catch (err: any) {
      if (err.message && err.message.toLowerCase().includes("failed to fetch")) {
        setError(`系统离线：无法连接到本地服务引擎。请检查后端是否正在运行（${apiBaseUrl}）。`);
      } else {
        setError(err instanceof Error ? err.message : "创建会话失败");
      }
    } finally {
      if (!resumePrompt) {
        setLoading(false);
      }
    }
  }

  async function handleStartFresh() {
    if (!resumePrompt) return;
    setLoading(true);
    setError(null);
    try {
      const api = createApiClient(apiBaseUrl);
      const response = await startFreshSession(api, resumePrompt.sessionId, targetDir, strategy);
      setResumePrompt(null);
      if (!response.session_id) {
        throw new Error("重新开始失败：后端未返回有效的访问 ID");
      }
      router.push(`/workspace?session_id=${response.session_id}&dir=${encodeURIComponent(targetDir)}`);
    } catch (err: any) {
      if (err.message && err.message.toLowerCase().includes("failed to fetch")) {
        setError(`系统离线：无法连接到本地服务引擎。请检查后端是否正在运行（${apiBaseUrl}）。`);
      } else {
        setError(err instanceof Error ? err.message : "重新开始失败");
      }
    } finally {
      setLoading(false);
    }
  }

  function handleCancelResume() {
    setResumePrompt(null);
    setLoading(false);
  }

  function handleConfirmResume() {
    if (!resumePrompt) return;
    router.push(`/workspace?session_id=${resumePrompt.sessionId}&dir=${encodeURIComponent(targetDir)}`);
  }

  return (
    <>
      <div className="relative mx-auto flex w-full max-w-4xl justify-center">
        <div className="w-full max-w-3xl space-y-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-outline-variant/15 bg-white/60 px-3 py-1 text-xs font-medium text-on-surface-variant/75">
            文件整理工作台
          </div>
          <div className="space-y-4">
            <h2 className="mx-auto max-w-3xl text-4xl font-black font-headline tracking-tight text-on-surface md:text-[4.25rem] md:leading-[1.02]">
              为目录建立更清楚的结构
            </h2>
            <p className="mx-auto max-w-2xl text-[16px] leading-8 text-on-surface-variant">
              先选择一个本地目录，再按你的整理策略开始扫描。整个流程更安静、更可控，也更适合反复修正方案。
            </p>
          </div>

          <div className="rounded-[34px] border border-on-surface/6 bg-white/72 p-7 shadow-[0_22px_60px_rgba(36,48,42,0.06)] backdrop-blur-sm text-left">
            <div className="mb-4 text-sm font-medium text-on-surface-variant/75">目录选择</div>
            <div className="relative">
              <button
                type="button"
                onClick={handleSelectDir}
                disabled={loading}
                className="absolute left-4 top-1/2 -translate-y-1/2 rounded-xl p-2 text-outline transition-colors hover:bg-surface-container hover:text-primary disabled:opacity-50"
                title="浏览文件夹"
              >
                <FolderOpen className="h-5 w-5" />
              </button>
              <input
                value={targetDir}
                onChange={(event) => setTargetDir(event.target.value)}
                disabled={loading}
                className="w-full rounded-[26px] border border-on-surface/8 bg-surface-container-low/25 py-5 pl-16 pr-44 text-[15px] text-on-surface outline-none transition-all placeholder:text-outline-variant/60 focus:border-primary/20 focus:ring-2 focus:ring-primary/10 disabled:opacity-70"
                placeholder="例如: D:\\Downloads"
                onKeyDown={(e) => {
                  if (e.key === "Enter") openStrategyDialog();
                }}
              />
              <button
                type="button"
                onClick={openStrategyDialog}
                disabled={loading || !targetDir.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-[18px] bg-primary px-5 py-3 text-sm font-bold text-white transition-all hover:opacity-90 hover:scale-[0.98] disabled:opacity-50 disabled:scale-100 flex items-center gap-2"
              >
                {loading ? "处理中" : "开始整理"}
                {!loading && <ArrowRight className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-6 flex items-start gap-3 rounded-[22px] border border-error/10 bg-error-container/20 px-4 py-3 text-sm font-medium text-error">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <p className="leading-relaxed">{error}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <StrategyDialog
        open={strategyDialogOpen}
        loading={loading}
        targetDir={targetDir}
        strategy={strategy}
        onClose={() => setStrategyDialogOpen(false)}
        onConfirm={() => void handleLaunch()}
        onTemplateSelect={handleTemplateSelect}
        onChangeNaming={(id) => setStrategy((prev) => ({ ...prev, naming_style: id }))}
        onChangeCaution={(id) => setStrategy((prev) => ({ ...prev, caution_level: id }))}
        onChangeNote={(value) => setStrategy((prev) => ({ ...prev, note: value }))}
      />

      <AnimatePresence>
        {resumePrompt && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-surface/78 backdrop-blur-md p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="w-full max-w-2xl rounded-[30px] border border-outline-variant/20 bg-surface-container-lowest p-8 shadow-[0_24px_60px_rgba(36,48,42,0.16)]"
            >
              <div className="mb-6 flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <History className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-xl font-bold font-headline text-on-surface">发现进行中的整理工作</h2>
                  <p className="text-sm text-on-surface-variant">
                    如果继续上次会话，将沿用当时的策略配置和当前整理阶段。
                  </p>
                </div>
              </div>

              <p className="mb-5 text-sm leading-relaxed text-on-surface-variant">
                引擎检测到该目录（<strong>{targetDir.split(/[\\/]/).pop()}</strong>）之前有未完成的整理进度（所在阶段：
                <em>{STAGE_LABELS[resumePrompt.snapshot.stage] || resumePrompt.snapshot.stage}</em>）。
              </p>

              <div className="mb-6 space-y-3 rounded-[24px] border border-on-surface/6 bg-surface-container-low/55 px-5 py-5">
                <p className="text-xs font-medium text-on-surface-variant">继续上次整理时将沿用旧策略</p>
                <StrategySummaryChips strategy={resumeStrategy} />
              </div>

              <div className="flex flex-col gap-3">
                <button
                  onClick={handleConfirmResume}
                  className="w-full rounded-xl bg-primary py-3 font-bold text-white transition-opacity hover:opacity-90 active:scale-[0.98]"
                >
                  继续上次整理
                </button>
                <div className="rounded-[20px] border border-on-surface/8 px-4 py-3 text-xs leading-6 text-on-surface-variant">
                  如果选择“重新开始”，将放弃旧会话并使用你当前选中的新策略重新创建整理任务。
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => void handleStartFresh()}
                    className="w-full rounded-xl bg-surface-container py-3 font-bold text-on-surface transition-colors hover:bg-surface-container-high active:scale-[0.98]"
                  >
                    重新开始
                  </button>
                  <button
                    onClick={handleCancelResume}
                    className="w-full rounded-xl border border-outline-variant/30 py-3 font-bold text-on-surface-variant transition-colors hover:bg-surface-container-low active:scale-[0.98]"
                  >
                    取消
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
