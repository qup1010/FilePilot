"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileSearch,
  FolderOpen,
  History,
  Layers3,
  MousePointer2,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn, getFriendlyStatus } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import { createApiClient } from "@/lib/api";
import { startFreshSession } from "@/lib/session-launcher-actions";
import { getApiBaseUrl, getApiToken, isTauriDesktop, pickDirectoryWithTauri } from "@/lib/runtime";
import {
  CAUTION_LEVEL_OPTIONS,
  DEFAULT_STRATEGY_SELECTION,
  getSuggestedSelection,
  getTemplateMeta,
  NAMING_STYLE_OPTIONS,
  STRATEGY_TEMPLATES,
} from "@/lib/strategy-templates";
import { SessionSnapshot, SessionStrategySelection, SessionStrategySummary } from "@/types/session";


const STAGE_LABELS: Record<string, string> = {
  idle: "准备中",
  draft: "正在准备方案",
  scanning: "正在扫描",
  planning: "正在整理方案",
  ready_for_precheck: "可开始预检",
  ready_to_execute: "等待执行",
  executing: "正在执行整理",
  completed: "整理已完成",
  rolling_back: "正在回退",
  abandoned: "已放弃",
  stale: "方案已过期",
  interrupted: "已中断",
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
      <span className="rounded-full bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary">{strategy.template_label}</span>
      <span className="rounded-full border border-on-surface/8 bg-white px-3 py-1 text-[11px] font-bold text-on-surface-variant">
        {strategy.naming_style_label}
      </span>
      <span className="rounded-full border border-on-surface/8 bg-white px-3 py-1 text-[11px] font-bold text-on-surface-variant">
        {strategy.caution_level_label}
      </span>
      {strategy.note ? (
        <span className="rounded-full bg-warning-container/20 px-3 py-1 text-[11px] font-bold text-on-surface-variant">
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
  const [step, setStep] = useState<1 | 2>(1);
  const currentTemplate = useMemo(() => getTemplateMeta(strategy.template_id), [strategy.template_id]);
  const previewDirectories = currentTemplate.previewDirectories[strategy.naming_style] || [];
  const namingLabel = NAMING_STYLE_OPTIONS.find((item) => item.id === strategy.naming_style)?.label || "中文目录";
  const cautionLabel = CAUTION_LEVEL_OPTIONS.find((item) => item.id === strategy.caution_level)?.label || "平衡";

  // When opening, reset to step 1
  useEffect(() => {
    if (open) setStep(1);
  }, [open]);

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
                <div className="flex items-center gap-3">
                  <div className="inline-flex items-center gap-2 rounded-full border border-primary/10 bg-primary/8 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-primary">
                    <Layers3 className="h-3.5 w-3.5" />
                    整理设置
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className={cn("h-1 w-8 rounded-full transition-all duration-500", step === 1 ? "bg-primary w-12" : "bg-primary/10")} />
                    <div className={cn("h-1 w-8 rounded-full transition-all duration-500", step === 2 ? "bg-primary w-12" : "bg-primary/10")} />
                  </div>
                </div>
                <div className="space-y-1">
                  <h2 className="text-2xl font-black font-headline tracking-tight text-on-surface uppercase tracking-widest leading-tight">
                    {step === 1 ? "第一步：选择整理模板" : "第二步：补充一些偏好"}
                  </h2>
                  <p className="max-w-2xl text-[13px] font-bold text-on-surface-variant/60 uppercase tracking-widest">
                    {step === 1 
                      ? "先选一个更接近当前目录的整理方式" 
                      : "如果你有明确习惯，也可以在这里补充给系统"}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="hidden rounded-2xl border border-on-surface/8 bg-surface-container-low/35 px-5 py-3 lg:block">
                  <div className="text-[11px] font-black text-on-surface-variant/40 uppercase tracking-widest">目标目录</div>
                  <p className="mt-1 max-w-[260px] truncate text-[13px] font-black text-on-surface font-mono opacity-80" title={targetDir}>{targetDir}</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onClose}
                  className="w-11 h-11 p-0 rounded-full"
                  title="关闭"
                >
                  <X className="h-4.5 w-4.5" />
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
              <AnimatePresence mode="wait">
                {step === 1 ? (
                  <motion.div
                    key="step-1"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="grid gap-8 lg:grid-cols-[320px_minmax(0,1fr)]"
                  >
                    <div className="space-y-4">
                      <div className="text-[11px] font-black text-on-surface-variant/40 uppercase tracking-[0.2em] px-1">可选模板</div>
                      <div className="space-y-3">
                        {STRATEGY_TEMPLATES.map((template) => {
                          const active = strategy.template_id === template.id;
                          return (
                            <button
                              key={template.id}
                              type="button"
                              disabled={loading}
                              onClick={() => {
                                onTemplateSelect(template.id);
                              }}
                              className={cn(
                                "w-full rounded-[28px] border-2 px-6 py-5 text-left transition-all disabled:opacity-50 group relative overflow-hidden",
                                active
                                  ? "border-primary bg-primary/5 text-on-surface shadow-xl shadow-primary/10"
                                  : "border-on-surface/5 bg-white/50 text-on-surface-variant hover:border-primary/20 hover:bg-white",
                              )}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <p className={cn("text-[15px] font-black tracking-tight", active ? "text-primary" : "text-on-surface")}>{template.label}</p>
                                {active && (
                                   <div className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center">
                                     <CheckCircle2 className="h-3.5 w-3.5" />
                                   </div>
                                )}
                              </div>
                              <p className="text-[12px] font-bold leading-relaxed text-on-surface-variant/60 group-hover:text-on-surface-variant/80 transition-colors uppercase tracking-widest">{template.description}</p>
                              
                              {active && (
                                <motion.div 
                                  layoutId="active-indicator"
                                  className="absolute left-0 top-0 bottom-0 w-1 bg-primary"
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-10">
                      <div className="rounded-[40px] border border-on-surface/10 bg-white shadow-2xl shadow-on-surface/5 p-10">
                        <div className="grid gap-12 lg:grid-cols-[1.2fr_0.8fr]">
                          <div className="space-y-10">
                            <div className="space-y-4">
                              <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-[11px] font-black uppercase tracking-[0.2em] text-primary">
                                <Sparkles className="h-4 w-4" />
                                整理预览
                              </div>
                              <h3 className="text-4xl font-black font-headline tracking-tighter text-on-surface uppercase">{currentTemplate.label}</h3>
                              <p className="max-w-xl text-[15px] font-bold leading-8 text-on-surface-variant/60">{currentTemplate.description}</p>
                            </div>
                            
                            <div className="space-y-4">
                              <div className="text-[11px] font-black text-on-surface-variant/40 uppercase tracking-[0.3em]">适用场景</div>
                              <div className="text-[15px] font-bold leading-8 text-on-surface bg-surface-container-low/60 rounded-[28px] p-6 border border-on-surface/5 shadow-inner italic">
                                "{currentTemplate.applicableScenarios}"
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-4">
                              <div className="rounded-full border border-on-surface/8 bg-white px-5 py-2.5 text-[11px] font-black uppercase tracking-widest text-on-surface-variant/60 flex items-center gap-3 shadow-sm">
                                <span className="opacity-30">命名风格:</span> {namingLabel}
                              </div>
                              <div className="rounded-full border border-on-surface/8 bg-white px-5 py-2.5 text-[11px] font-black uppercase tracking-widest text-on-surface-variant/60 flex items-center gap-3 shadow-sm">
                                <span className="opacity-30">整理方式:</span> {cautionLabel}
                              </div>
                            </div>
                          </div>

                          <div className="space-y-6 rounded-[32px] bg-surface-container-low/30 p-8 border border-on-surface/5 relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-4 opacity-10 rotate-12 group-hover:rotate-0 transition-transform duration-1000">
                               <FolderOpen className="w-12 h-12" />
                            </div>
                            <div className="text-[11px] font-black text-on-surface-variant/40 uppercase tracking-[0.3em] mb-4">可能用到的目录</div>
                            <div className="space-y-3">
                              {previewDirectories.map((directory, index) => (
                                <motion.div
                                  initial={{ opacity: 0, x: 20 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: index * 0.1 }}
                                  key={`${strategy.template_id}-${strategy.naming_style}-${directory}`}
                                  className="flex items-center gap-4 rounded-[22px] bg-white px-5 py-4 shadow-sm border border-on-surface/5 hover:border-primary/20 transition-colors"
                                >
                                  <div className="w-2 h-2 rounded-full bg-primary/20" />
                                  <span className="text-[14px] font-black text-on-surface tracking-tight">{directory}</span>
                                </motion.div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-4 rounded-[28px] bg-primary/5 border border-primary/10 p-6 px-8 shadow-sm">
                        <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center text-primary shadow-sm">
                          <AlertTriangle className="h-5 w-5" />
                        </div>
                        <p className="text-[13px] font-bold text-primary/80 leading-relaxed uppercase tracking-widest">
                          现在还不会移动文件。你可以先看一下，再决定是否继续。
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="step-2"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    className="grid gap-6 lg:grid-cols-2"
                  >
                    <div className="space-y-6">
                      <div className="rounded-[26px] border border-on-surface/6 bg-white/68 p-6">
                        <div className="mb-6 flex items-center justify-between">
                          <span className="text-[11px] font-black text-on-surface-variant/40 uppercase tracking-[0.3em]">目录命名风格</span>
                        </div>
                        <div className="grid grid-cols-1 gap-3">
                          {NAMING_STYLE_OPTIONS.map((option) => {
                            const active = strategy.naming_style === option.id;
                            return (
                              <button
                                key={option.id}
                                type="button"
                                disabled={loading}
                                onClick={() => onChangeNaming(option.id)}
                                className={cn(
                                  "w-full rounded-[24px] border-2 px-6 py-5 text-left transition-all disabled:opacity-50",
                                  active ? "border-primary bg-primary/5 shadow-lg shadow-primary/5" : "border-on-surface/5 bg-surface-container-low/50 hover:border-primary/20",
                                )}
                              >
                                <p className={cn("text-[14px] font-black uppercase tracking-tight", active ? "text-primary" : "text-on-surface")}>{option.label}</p>
                                <p className="mt-1 text-[12px] font-bold text-on-surface-variant/50 leading-relaxed uppercase tracking-widest">{option.description}</p>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="rounded-[26px] border border-on-surface/6 bg-white/68 p-6">
                        <div className="mb-6 flex items-center justify-between">
                          <span className="text-[11px] font-black text-on-surface-variant/40 uppercase tracking-[0.3em]">整理保守度</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          {CAUTION_LEVEL_OPTIONS.map((option) => {
                            const active = strategy.caution_level === option.id;
                            return (
                              <button
                                key={option.id}
                                type="button"
                                disabled={loading}
                                onClick={() => onChangeCaution(option.id)}
                                className={cn(
                                  "flex flex-col h-full rounded-[24px] border-2 px-6 py-6 text-left transition-all disabled:opacity-50",
                                  active ? "border-primary bg-primary/5 shadow-lg shadow-primary/5" : "border-on-surface/5 bg-surface-container-low/50 hover:border-primary/20",
                                )}
                              >
                                <p className={cn("text-[14px] font-black mb-2 uppercase tracking-tight", active ? "text-primary" : "text-on-surface")}>{option.label}</p>
                                <p className="text-[12px] font-bold text-on-surface-variant/50 leading-relaxed uppercase tracking-widest">{option.description}</p>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="rounded-[32px] border border-on-surface/10 bg-white p-8 h-full flex flex-col shadow-xl shadow-on-surface/5">
                        <div className="mb-6 flex items-center justify-between px-2">
                          <span className="text-[11px] font-black text-on-surface-variant/40 uppercase tracking-[0.3em]">补充说明</span>
                          <span className="text-[11px] font-black text-primary/40 uppercase tracking-widest">OPTIONAL</span>
                        </div>
                        <textarea
                          value={strategy.note}
                          disabled={loading}
                          onChange={(event) => onChangeNote(event.target.value.slice(0, 200))}
                          placeholder="例如：项目文件尽量放在一起；拿不准的先放 Review。"
                          className="flex-1 w-full rounded-[28px] border-2 border-on-surface/5 bg-surface-container-low/20 px-6 py-6 text-[15px] font-bold leading-relaxed text-on-surface outline-none transition-all placeholder:text-on-surface-variant/20 focus:border-primary/40 focus:ring-8 focus:ring-primary/5 disabled:opacity-50 resize-none shadow-inner"
                        />
                        <div className="mt-8 flex items-center gap-4 rounded-[24px] bg-primary/5 p-6 border border-primary/10">
                          <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center text-primary shadow-sm">
                             <Sparkles className="h-5 w-5" />
                          </div>
                          <p className="text-[12px] font-bold text-primary/80 leading-relaxed uppercase tracking-[0.1em]">
                            这些说明会作为整理偏好一起参考。
                          </p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="shrink-0 border-t border-on-surface/6 bg-white/92 px-8 py-5 backdrop-blur-sm">
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-[28px] border border-on-surface/6 bg-surface/72 px-6 py-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="text-xs font-bold text-on-surface-variant/60 uppercase tracking-wider">已选配置</div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-[11px] font-bold text-primary">{currentTemplate.label}</span>
                    {step === 2 && (
                      <span className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-on-surface-variant border border-on-surface/8">
                        {namingLabel} · {cautionLabel}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {step === 1 ? (
                    <>
                      <Button
                        variant="secondary"
                        onClick={onClose}
                        className="px-8 py-3.5"
                      >
                        取消
                      </Button>
                      <Button
                        variant="primary"
                        onClick={() => setStep(2)}
                        className="px-10 py-3.5"
                      >
                        下一步
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="secondary"
                        onClick={() => setStep(1)}
                        className="px-8 py-3.5"
                      >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        返回上一步
                      </Button>
                      <Button
                        variant="primary"
                        onClick={onConfirm}
                        disabled={loading}
                        loading={loading}
                        className="px-10 py-3.5"
                      >
                        {loading ? "处理中" : "确认并开始扫描"}
                      </Button>
                    </>
                  )}
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
  const resumeStage = resumePrompt?.snapshot.stage;
  const isCompletedResume = resumeStage === "completed";

  async function handleSelectDir() {
    setLoading(true);
    setError(null);
    try {
      if (isTauriDesktop()) {
        const selectedPath = await pickDirectoryWithTauri();
        if (selectedPath) {
          setTargetDir(selectedPath);
        }
        return;
      }

      const api = createApiClient(apiBaseUrl, getApiToken());
      const response = await api.selectDir();
      if (response.path) {
        setTargetDir(response.path);
      }
    } catch (_err) {
      setError(isTauriDesktop() ? "没有打开目录选择窗口，请再试一次。" : "现在还不能打开目录选择器，请检查本地服务是否正常运行。");
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
      const api = createApiClient(apiBaseUrl, getApiToken());
      const response = await api.createSession(targetDir, true, strategy);
      if (response.mode === "resume_available" && response.restorable_session?.session_id) {
        setResumePrompt({
          sessionId: response.restorable_session.session_id,
          snapshot: response.restorable_session,
        });
        return;
      }
      if (!response.session_id) {
        throw new Error("没有成功创建整理会话，请再试一次。");
      }
      router.push(`/workspace?session_id=${response.session_id}&dir=${encodeURIComponent(targetDir)}`);
    } catch (err: any) {
      if (err.message && err.message.toLowerCase().includes("failed to fetch")) {
        setError(`现在连不上本地服务，请确认它是否已经启动（${apiBaseUrl}）。`);
      } else {
        setError(err instanceof Error ? err.message : "创建整理会话失败，请再试一次。");
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
      const api = createApiClient(apiBaseUrl, getApiToken());
      const response = await startFreshSession(
        api,
        resumePrompt.sessionId,
        targetDir,
        strategy,
        resumePrompt.snapshot.stage,
      );
      setResumePrompt(null);
      if (!response.session_id) {
        throw new Error("没有成功重新开始，请再试一次。");
      }
      router.push(`/workspace?session_id=${response.session_id}&dir=${encodeURIComponent(targetDir)}`);
    } catch (err: any) {
      if (err.message && err.message.toLowerCase().includes("failed to fetch")) {
        setError(`现在连不上本地服务，请确认它是否已经启动（${apiBaseUrl}）。`);
      } else {
        setError(err instanceof Error ? err.message : "重新开始失败，请再试一次。");
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

  function handleReadOnlyView() {
    if (!resumePrompt) return;
    router.push(`/workspace?session_id=${resumePrompt.sessionId}&dir=${encodeURIComponent(targetDir)}&readonly=1`);
  }

  return (
    <>
      <div className="relative mx-auto flex w-full max-w-4xl justify-center">
        <div className="w-full max-w-3xl space-y-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-outline-variant/15 bg-white/60 px-3 py-1 text-xs font-medium text-on-surface-variant/75">
            文件整理
          </div>
          <div className="space-y-4">
            <h2 className="mx-auto max-w-3xl text-4xl font-black font-headline tracking-tight text-on-surface md:text-[4.25rem] md:leading-[1.02]">
              为目录建立更清楚的结构
            </h2>
            <p className="mx-auto max-w-2xl text-[16px] leading-8 text-on-surface-variant">
              先选一个本地目录，再按你的习惯开始整理。整个过程会尽量清楚、稳妥，也方便你随时调整。
            </p>
          </div>

          <div className="rounded-[34px] border border-on-surface/10 bg-white/80 p-10 shadow-[0_32px_80px_rgba(36,48,42,0.08)] backdrop-blur-xl text-left">
            <div className="mb-6 flex items-center justify-between">
              <div className="text-[11px] font-black text-on-surface-variant/40 uppercase tracking-[0.3em]">整理步骤</div>
              <div className="flex items-center gap-6 text-[11px] font-black text-on-surface-variant/30 uppercase tracking-[0.2em]">
                <span className="flex items-center gap-2 group transition-colors hover:text-primary"><Search className="h-3.5 w-3.5" /> 1. 扫描</span>
                <div className="w-4 h-px bg-on-surface/10" />
                <span className="flex items-center gap-2 group transition-colors hover:text-primary"><FileSearch className="h-3.5 w-3.5" /> 2. 调整方案</span>
                <div className="w-4 h-px bg-on-surface/10" />
                <span className="flex items-center gap-2 group transition-colors hover:text-primary"><CheckCircle2 className="h-3.5 w-3.5" /> 3. 确认执行</span>
              </div>
            </div>
            <div className="relative group">
              <Button
                variant="ghost"
                onClick={handleSelectDir}
                disabled={loading}
                className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 p-0 rounded-xl hover:bg-surface-container-low"
                title="浏览文件夹"
              >
                <FolderOpen className="h-5 w-5" />
              </Button>
              <input
                value={targetDir}
                onChange={(event) => setTargetDir(event.target.value)}
                disabled={loading}
                className="w-full rounded-[28px] border-2 border-on-surface/5 bg-surface-container-low/20 py-6 pl-16 pr-44 text-[15px] font-bold text-on-surface outline-none transition-all placeholder:text-on-surface-variant/20 focus:border-primary/40 focus:ring-8 focus:ring-primary/5 disabled:opacity-70 shadow-inner"
                placeholder="例如: D:\\Downloads\\Incomplete"
                onKeyDown={(e) => {
                  if (e.key === "Enter") openStrategyDialog();
                }}
              />
              <Button
                variant="primary"
                onClick={openStrategyDialog}
                disabled={loading || !targetDir.trim()}
                loading={loading}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 px-8 py-4 h-[calc(100%-1.25rem)] rounded-[22px]"
              >
                {loading ? "处理中" : "开始整理"}
                {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
              </Button>
            </div>
            
            <div className="mt-8 flex items-center px-2">
              <div className="flex items-center gap-3 text-[11px] font-black text-emerald-600 uppercase tracking-widest bg-emerald-500/5 px-4 py-2 rounded-full border border-emerald-500/10">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>操作安全且可随时回退</span>
              </div>
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
                  <h2 className="text-xl font-black font-headline text-on-surface uppercase tracking-tight">
                    {isCompletedResume ? "发现之前的整理记录" : "发现上一次还没整理完"}
                  </h2>
                  <p className="text-[13px] font-bold text-on-surface-variant/60 uppercase tracking-widest">
                    {isCompletedResume
                      ? "你可以先看看之前的结果，也可以按现在的设置重新开始"
                      : "你可以继续上一次，或者重新开始这次整理"}
                  </p>
                </div>
              </div>

              <p className="mb-5 text-sm leading-relaxed text-on-surface-variant">
                检测到这个目录（<strong>{targetDir.split(/[\\/]/).pop()}</strong>）
                {isCompletedResume ? "之前已经整理过一次" : "之前还有一条未完成的记录"}（当前阶段：
                <em>{STAGE_LABELS[resumePrompt.snapshot.stage] || resumePrompt.snapshot.stage}</em>）。
              </p>

              <div className="mb-8 space-y-4 rounded-[28px] border border-on-surface/5 bg-surface-container-low/40 p-6 shadow-inner">
                <p className="text-[11px] font-black text-on-surface-variant/40 uppercase tracking-[0.2em]">上一次使用的设置</p>
                <StrategySummaryChips strategy={resumeStrategy} />
              </div>

              <div className="flex flex-col gap-4">
                <Button
                  variant="primary"
                  onClick={handleConfirmResume}
                  className="w-full py-4 text-sm"
                >
                  {isCompletedResume ? "查看之前的结果" : "继续上一次整理"}
                </Button>
                <div className="rounded-2xl border border-on-surface/5 bg-on-surface/5 px-5 py-4 text-[12px] font-bold leading-relaxed text-on-surface-variant/60 uppercase tracking-widest">
                  {isCompletedResume
                    ? "重新开始会按你现在的设置重新扫描这个目录。"
                    : "重新开始会放弃上一次未完成的状态，并按现在的设置重新扫描。"}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => void handleStartFresh()}
                    className="py-3.5"
                  >
                    重新开始
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={handleReadOnlyView}
                    className="py-3.5"
                  >
                    只读查看
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={handleCancelResume}
                    className="py-3.5"
                  >
                    取消
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
