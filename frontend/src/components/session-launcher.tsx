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
      <span className="rounded-[8px] border border-primary/12 bg-primary/8 px-2.5 py-1 text-[12px] font-semibold text-primary">{strategy.template_label}</span>
      <span className="rounded-[8px] border border-on-surface/8 bg-surface-container-lowest px-2.5 py-1 text-[12px] font-medium text-on-surface-variant">
        {strategy.naming_style_label}
      </span>
      <span className="rounded-[8px] border border-on-surface/8 bg-surface-container-lowest px-2.5 py-1 text-[12px] font-medium text-on-surface-variant">
        {strategy.caution_level_label}
      </span>
      {strategy.note ? (
        <span className="rounded-[8px] border border-warning/10 bg-warning-container/30 px-2.5 py-1 text-[12px] font-medium text-on-surface-variant">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface/72 px-4 py-6 backdrop-blur-[4px]">
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 20 }}
            className="flex h-[min(84vh,820px)] w-full max-w-[1080px] flex-col overflow-hidden rounded-[14px] border border-on-surface/8 bg-surface-container-lowest shadow-[0_18px_52px_rgba(37,45,40,0.14)]"
          >
            <div className="flex shrink-0 items-start justify-between gap-6 border-b border-on-surface/8 bg-surface-container-low px-5 py-4 lg:px-6">
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="inline-flex items-center gap-2 rounded-[8px] border border-primary/12 bg-primary/8 px-2.5 py-1 text-[12px] font-semibold text-primary">
                    <Layers3 className="h-3.5 w-3.5" />
                    整理设置
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={cn("h-1.5 w-7 rounded-full transition-all duration-300", step === 1 ? "bg-primary" : "bg-primary/12")} />
                    <div className={cn("h-1.5 w-7 rounded-full transition-all duration-300", step === 2 ? "bg-primary" : "bg-primary/12")} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <h2 className="text-[1.15rem] font-black font-headline tracking-tight text-on-surface leading-tight lg:text-[1.32rem]">
                    {step === 1 ? "第一步：选择整理模板" : "第二步：补充整理偏好"}
                  </h2>
                  <p className="max-w-2xl text-[13px] leading-6 text-ui-muted">
                    {step === 1 
                      ? "先选一个更接近当前目录的整理方式" 
                      : "如果你有明确习惯，也可以在这里补充给系统"}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="hidden rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3 lg:block">
                  <div className="text-ui-meta text-ui-muted">目标目录</div>
                  <p className="mt-1 max-w-[260px] truncate font-mono text-[12px] font-medium text-on-surface" title={targetDir}>{targetDir}</p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onClose}
                  className="h-10 w-10 rounded-[10px] p-0"
                  title="关闭"
                >
                  <X className="h-4.5 w-4.5" />
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 lg:px-6">
              <AnimatePresence mode="wait">
                {step === 1 ? (
                  <motion.div
                    key="step-1"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]"
                  >
                    <div className="space-y-4">
                      <div className="px-1 text-[12px] font-medium text-ui-muted">可选模板</div>
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
                                "group relative w-full overflow-hidden rounded-[12px] border px-4 py-4 text-left transition-colors disabled:opacity-50",
                                active
                                  ? "border-primary/20 bg-primary/6 text-on-surface"
                                  : "border-on-surface/8 bg-surface-container-lowest text-on-surface-variant hover:border-primary/16 hover:bg-white",
                              )}
                            >
                              <div className="mb-2 flex items-center justify-between">
                                <p className={cn("text-[14px] font-semibold tracking-tight", active ? "text-primary" : "text-on-surface")}>{template.label}</p>
                                {active && (
                                   <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white">
                                     <CheckCircle2 className="h-3.5 w-3.5" />
                                   </div>
                                )}
                              </div>
                              <p className="text-[13px] leading-6 text-ui-muted transition-colors group-hover:text-on-surface-variant">{template.description}</p>
                              
                              {active && (
                                <motion.div 
                                  layoutId="active-indicator"
                                  className="absolute bottom-0 left-0 top-0 w-[3px] bg-primary"
                                />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-5">
                      <div className="rounded-[12px] border border-on-surface/8 bg-surface-container-lowest p-5">
                        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                          <div className="space-y-7">
                            <div className="space-y-3">
                              <div className="text-[12px] font-medium text-ui-muted">当前模板</div>
                              <h3 className="text-[1.32rem] font-black font-headline tracking-tight text-on-surface lg:text-[1.45rem]">{currentTemplate.label}</h3>
                              <p className="max-w-xl text-[14px] leading-7 text-ui-muted">{currentTemplate.description}</p>
                            </div>
                            
                            <div className="space-y-3">
                              <div className="text-[12px] font-medium text-ui-muted">适用场景</div>
                              <div className="rounded-[10px] border border-on-surface/8 bg-surface-container-low px-5 py-4 text-[14px] leading-7 text-on-surface">
                                {currentTemplate.applicableScenarios}
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-3">
                              <div className="flex items-center gap-2 rounded-full border border-on-surface/8 bg-surface-container-lowest px-4 py-2 text-[12px] font-medium text-on-surface-variant">
                                <span className="text-ui-muted">命名风格</span> {namingLabel}
                              </div>
                              <div className="flex items-center gap-2 rounded-full border border-on-surface/8 bg-surface-container-lowest px-4 py-2 text-[12px] font-medium text-on-surface-variant">
                                <span className="text-ui-muted">整理方式</span> {cautionLabel}
                              </div>
                            </div>
                          </div>

                          <div className="rounded-[12px] border border-on-surface/8 bg-surface-container-low p-5">
                            <div className="mb-4 text-[12px] font-medium text-ui-muted">预计会创建或使用的目录</div>
                            <div className="space-y-3">
                              {previewDirectories.map((directory, index) => (
                                <motion.div
                                  initial={{ opacity: 0, x: 20 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: index * 0.1 }}
                                  key={`${strategy.template_id}-${strategy.naming_style}-${directory}`}
                                  className="flex items-center gap-3 rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3 transition-colors hover:border-primary/16"
                                >
                                  <div className="h-2 w-2 rounded-full bg-primary/30" />
                                  <span className="text-[14px] font-semibold text-on-surface">{directory}</span>
                                </motion.div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-start gap-4 rounded-[12px] border border-primary/12 bg-primary/6 px-5 py-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-surface-container-lowest text-primary">
                          <AlertTriangle className="h-5 w-5" />
                        </div>
                        <p className="text-[13px] leading-6 text-primary/85">
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
                    className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]"
                  >
                    <div className="space-y-6">
                      <div className="rounded-[12px] border border-on-surface/8 bg-surface-container-lowest p-5">
                        <div className="mb-6 flex items-center justify-between">
                          <span className="text-[12px] font-medium text-ui-muted">目录命名风格</span>
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
                                  "w-full rounded-[10px] border px-4 py-4 text-left transition-colors disabled:opacity-50",
                                  active ? "border-primary/20 bg-primary/6" : "border-on-surface/8 bg-surface-container-low hover:border-primary/16",
                                )}
                              >
                                <p className={cn("text-[14px] font-semibold tracking-tight", active ? "text-primary" : "text-on-surface")}>{option.label}</p>
                                <p className="mt-1 text-[13px] leading-6 text-ui-muted">{option.description}</p>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="rounded-[12px] border border-on-surface/8 bg-surface-container-lowest p-5">
                        <div className="mb-6 flex items-center justify-between">
                          <span className="text-[12px] font-medium text-ui-muted">整理保守度</span>
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
                                  "flex h-full flex-col rounded-[10px] border px-4 py-4 text-left transition-colors disabled:opacity-50",
                                  active ? "border-primary/20 bg-primary/6" : "border-on-surface/8 bg-surface-container-low hover:border-primary/16",
                                )}
                              >
                                <p className={cn("mb-2 text-[14px] font-semibold tracking-tight", active ? "text-primary" : "text-on-surface")}>{option.label}</p>
                                <p className="text-[13px] leading-6 text-ui-muted">{option.description}</p>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-6">
                      <div className="flex h-full flex-col rounded-[12px] border border-on-surface/8 bg-surface-container-lowest p-5">
                        <div className="mb-6 flex items-center justify-between px-2">
                          <span className="text-[12px] font-medium text-ui-muted">补充说明</span>
                          <span className="text-ui-meta text-ui-muted">可选</span>
                        </div>
                        <textarea
                          value={strategy.note}
                          disabled={loading}
                          onChange={(event) => onChangeNote(event.target.value.slice(0, 200))}
                          placeholder="例如：项目文件尽量放在一起；拿不准的先放 Review。"
                          className="flex-1 w-full resize-none rounded-[10px] border border-on-surface/8 bg-surface-container-low px-4 py-4 text-[14px] leading-7 text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary/40 focus:ring-4 focus:ring-primary/5 disabled:opacity-50"
                        />
                        <div className="mt-5 flex items-start gap-4 rounded-[10px] border border-primary/12 bg-primary/6 p-4">
                          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-surface-container-lowest text-primary">
                             <Sparkles className="h-5 w-5" />
                          </div>
                          <p className="text-[13px] leading-6 text-primary/85">
                            这些说明会作为整理偏好一起参考。
                          </p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="shrink-0 border-t border-on-surface/8 bg-surface-container-low px-5 py-4 lg:px-6">
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-[12px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="text-[12px] font-medium text-ui-muted">已选配置</div>
                  <div className="flex flex-wrap gap-1.5">
                    <span className="rounded-full border border-primary/12 bg-primary/8 px-3 py-1 text-[12px] font-semibold text-primary">{currentTemplate.label}</span>
                    {step === 2 && (
                      <span className="rounded-full border border-on-surface/8 bg-surface-container-lowest px-3 py-1 text-[12px] font-medium text-on-surface-variant">
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
                        className="px-6 py-3"
                      >
                        取消
                      </Button>
                      <Button
                        variant="primary"
                        onClick={() => setStep(2)}
                        className="px-7 py-3"
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
                        className="px-6 py-3"
                      >
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        返回上一步
                      </Button>
                      <Button
                        variant="primary"
                        onClick={onConfirm}
                        disabled={loading}
                        loading={loading}
                        className="px-7 py-3"
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
  const currentTemplate = getTemplateMeta(strategy.template_id);
  const currentPreviewDirectories = currentTemplate.previewDirectories[strategy.naming_style] || [];

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
      <div className="rounded-[12px] border border-on-surface/8 bg-surface-container-lowest shadow-[0_6px_18px_rgba(37,45,40,0.04)]">
        <div className="border-b border-on-surface/8 bg-surface-container-low px-4 py-6 lg:px-8 lg:py-8">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <div className="space-y-1.5 sm:space-y-3">
                <div className="inline-flex items-center gap-2 rounded-[8px] border border-primary/12 bg-primary/8 px-2.5 py-1 text-[11px] font-bold text-primary sm:text-[12px]">
                  文件整理
                </div>
                <h2 className="text-[1.45rem] font-black font-headline tracking-tighter text-on-surface sm:text-[1.85rem] lg:text-[2.25rem] leading-tight">
                  新建整理任务
                </h2>
                <p className="max-w-3xl text-[13px] leading-relaxed text-ui-muted sm:text-[15px]">
                  先确定目标目录和默认策略，再进入工作区继续调整。
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-on-surface/6 pt-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px]">
                <div className="inline-flex items-center gap-2 rounded-[8px] bg-surface-container-lowest px-2.5 py-1.5 text-on-surface">
                  <span className="flex h-5 w-5 items-center justify-center rounded-[6px] bg-primary/10 text-[11px] font-semibold text-primary">1</span>
                  <span className="font-medium">扫描目录</span>
                </div>
                <span className="hidden text-on-surface-variant/25 sm:inline">/</span>
                <div className="inline-flex items-center gap-2 rounded-[8px] bg-surface-container-lowest px-2.5 py-1.5 text-on-surface">
                  <span className="flex h-5 w-5 items-center justify-center rounded-[6px] bg-primary/10 text-[11px] font-semibold text-primary">2</span>
                  <span className="font-medium">调整方案</span>
                </div>
                <span className="hidden text-on-surface-variant/25 sm:inline">/</span>
                <div className="inline-flex items-center gap-2 rounded-[8px] bg-surface-container-lowest px-2.5 py-1.5 text-on-surface">
                  <span className="flex h-5 w-5 items-center justify-center rounded-[6px] bg-primary/10 text-[11px] font-semibold text-primary">3</span>
                  <span className="font-medium">预检后执行</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-ui-muted">
                <div className="inline-flex items-center gap-2">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  先确认设置，再创建会话
                </div>
                <div className="inline-flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-primary" />
                  真正移动文件前会再次预检
                </div>
                <div className="inline-flex items-center gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                  支持回退操作，过程更稳妥
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 p-4 min-[1360px]:grid-cols-[minmax(0,1fr)_minmax(260px,320px)] min-[1360px]:p-6 min-[1360px]:gap-4 2xl:p-8">
          <div className="min-w-0 rounded-[11px] border border-on-surface/8 bg-surface-container-low p-4 lg:p-5">
            <div className="mb-3">
              <div>
                <div className="text-[12px] font-medium text-ui-muted">目标目录</div>
                <p className="mt-1 text-[13px] leading-6 text-on-surface">输入路径或直接浏览本地文件夹。</p>
              </div>
            </div>

            <div className="relative">
              <Button
                variant="ghost"
                onClick={handleSelectDir}
                disabled={loading}
                className="absolute left-3 top-1/2 h-9 w-9 -translate-y-1/2 rounded-[9px] p-0 hover:bg-surface-container"
                title="浏览文件夹"
              >
                <FolderOpen className="h-4.5 w-4.5" />
              </Button>
              <input
                value={targetDir}
                onChange={(event) => setTargetDir(event.target.value)}
                disabled={loading}
                className="w-full min-w-0 rounded-[11px] border border-on-surface/8 bg-surface-container-lowest py-3.5 pl-[3.25rem] pr-4 text-[14px] font-medium text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary/40 focus:ring-4 focus:ring-primary/5 disabled:opacity-70"
                placeholder="例如: D:\\Downloads\\Incomplete"
                onKeyDown={(e) => {
                  if (e.key === "Enter") openStrategyDialog();
                }}
              />
            </div>

            <div className="mt-4 space-y-2.5 text-[12px] text-ui-muted">
              <div className="flex items-start gap-2">
                <Search className="mt-[2px] h-3.5 w-3.5 shrink-0 text-primary/70" />
                <span className="min-w-0 flex-1 leading-relaxed">扫描后可以继续调整方案，不需要重新开始</span>
              </div>
              <div className="flex items-start gap-2">
                <FileSearch className="mt-[2px] h-3.5 w-3.5 shrink-0 text-primary/70" />
                <span className="min-w-0 flex-1 leading-relaxed">有拿不准的内容会先进 `Review`</span>
              </div>
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-[2px] h-3.5 w-3.5 shrink-0 text-primary/70" />
                <span className="min-w-0 flex-1 leading-relaxed">支持回退操作，执行更安心</span>
              </div>
            </div>

            <div className="mt-3 flex justify-end border-t border-on-surface/6 pt-3">
              <Button
                variant="secondary"
                onClick={openStrategyDialog}
                disabled={loading || !targetDir.trim()}
                loading={loading}
                className="px-4 py-2.5"
              >
                {loading ? "处理中" : "整理设置"}
                {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="min-w-0 rounded-[11px] border border-on-surface/8 bg-surface-container-lowest p-4 lg:p-5">
            <div className="text-[12px] font-medium text-ui-muted">当前默认策略</div>
            <div className="mt-2 space-y-2">
              <h3 className="text-[1.02rem] font-black font-headline tracking-tight text-on-surface">
                {currentTemplate.label}
              </h3>
              <p className="text-[13px] leading-6 text-ui-muted">
                {currentTemplate.description}
              </p>
            </div>
            <div className="mt-3">
              <StrategySummaryChips
                strategy={{
                  ...strategy,
                  template_label: currentTemplate.label,
                  template_description: currentTemplate.description,
                  naming_style_label:
                    NAMING_STYLE_OPTIONS.find((item) => item.id === strategy.naming_style)?.label || "中文目录",
                  caution_level_label:
                    CAUTION_LEVEL_OPTIONS.find((item) => item.id === strategy.caution_level)?.label || "平衡",
                  preview_directories: currentPreviewDirectories,
                }}
              />
            </div>
            <div className="mt-4 space-y-2.5 border-t border-on-surface/6 pt-3">
              <div className="text-[12px] font-medium text-ui-muted">预计目录</div>
              <div className="space-y-2">
                {currentPreviewDirectories.slice(0, 3).map((directory) => (
                  <div
                    key={`${strategy.template_id}-${strategy.naming_style}-${directory}`}
                    className="flex items-center gap-2 rounded-[8px] bg-surface-container-low px-3 py-2 text-[13px] text-on-surface"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-primary/55" />
                    <span className="truncate">{directory}</span>
                  </div>
                ))}
              </div>
              {currentPreviewDirectories.length > 3 ? (
                <p className="text-[12px] text-ui-muted">进入整理设置后还可以继续查看完整目录示例。</p>
              ) : null}
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
              <div className="mx-4 mb-4 flex items-start gap-3 rounded-[12px] border border-error/12 bg-error-container/25 px-4 py-3 text-sm font-medium text-error lg:mx-5 lg:mb-5">
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
                  <h2 className="text-xl font-black font-headline text-on-surface tracking-tight">
                    {isCompletedResume ? "发现之前的整理记录" : "发现上一次还没整理完"}
                  </h2>
                  <p className="text-ui-body font-medium text-ui-muted">
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
                <p className="text-ui-section font-semibold text-ui-muted">上一次使用的设置</p>
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
                <div className="rounded-2xl border border-on-surface/5 bg-on-surface/5 px-5 py-4 text-ui-section font-medium leading-relaxed text-ui-muted">
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
