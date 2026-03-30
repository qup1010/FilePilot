"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FolderOpen,
  History,
  Layers3,
  Loader2,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import { createApiClient } from "@/lib/api";
import { createSessionAndStartScan, startFreshSession } from "@/lib/session-launcher-actions";
import { getApiBaseUrl, getApiToken, isTauriDesktop, pickDirectoryWithTauri } from "@/lib/runtime";
import {
  buildStrategySummary,
  CAUTION_LEVEL_OPTIONS,
  DEFAULT_STRATEGY_SELECTION,
  getLaunchStrategyFromConfig,
  getSuggestedSelection,
  getTemplateMeta,
  NAMING_STYLE_OPTIONS,
  shouldSkipLaunchStrategyPrompt,
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
      <span className="ui-pill border-primary/12 bg-primary/8 text-primary">{strategy.template_label}</span>
      <span className="ui-pill">{strategy.naming_style_label}</span>
      <span className="ui-pill">{strategy.caution_level_label}</span>
      {strategy.note ? (
        <span className="ui-pill border-warning/12 bg-warning-container/30">
          偏好：{strategy.note}
        </span>
      ) : null}
    </div>
  );
}

function LaunchTransitionOverlay({ open, targetDir }: { open: boolean; targetDir: string }) {
  const folderName = targetDir.replace(/[\\/]$/, "").split(/[\\/]/).pop() || "当前目录";

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none fixed inset-0 z-[120] flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(10,132,255,0.12),transparent_42%),rgba(244,247,250,0.82)] px-6 backdrop-blur-md"
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-[420px] overflow-hidden rounded-[18px] border border-on-surface/8 bg-surface/92 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.16)]"
          >
            <div className="flex items-start gap-4">
              <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-[16px] border border-primary/16 bg-primary/8 text-primary">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
                >
                  <Loader2 className="h-6 w-6" />
                </motion.div>
                <motion.span
                  animate={{ scale: [1, 1.3, 1], opacity: [0.22, 0.08, 0.22] }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute inset-0 rounded-[16px] border border-primary/20"
                />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary/72">
                  正在进入扫描工作区
                </p>
                <h3 className="mt-2 text-[22px] font-black tracking-tight text-on-surface">
                  正在建立扫描任务
                </h3>
                <p className="mt-2 text-[13px] leading-6 text-on-surface-variant/78">
                  已确认目录，正在初始化扫描任务并同步工作区状态。
                </p>

                <div className="mt-4 rounded-[12px] border border-on-surface/8 bg-surface-container-low/70 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-[13px] font-semibold text-on-surface">{folderName}</span>
                    <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                      即将扫描
                    </span>
                  </div>
                  <div className="mt-3 flex gap-1.5">
                    {[0, 1, 2].map((index) => (
                      <motion.span
                        key={index}
                        animate={{ opacity: [0.28, 1, 0.28], y: [0, -2, 0] }}
                        transition={{ duration: 0.9, repeat: Infinity, delay: index * 0.14, ease: "easeInOut" }}
                        className="h-1.5 w-1.5 rounded-full bg-primary"
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
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
  const directoryPreview = previewDirectories.map((directory, index) => {
    const suffix =
      strategy.template_id === "project_workspace"
        ? ["需求", "文档", "交付", "素材", "Review"][index] || "资料"
        : strategy.template_id === "study_materials"
          ? ["课程", "讲义", "练习", "参考", "Review"][index] || "资料"
          : strategy.template_id === "office_admin"
            ? ["报销", "合同", "周报", "表单", "Review"][index] || "资料"
            : strategy.template_id === "conservative"
              ? ["文档", "媒体", "安装包", "归档", "Review"][index] || "资料"
              : ["项目", "票据", "课程", "安装包", "Review"][index] || "资料";
    return `${directory}/${suffix}`;
  });
  const templateTag = currentTemplate.defaultCautionLevel === "conservative" ? "改动更克制" : "适合常规整理";

  // When opening, reset to step 1
  useEffect(() => {
    if (open) setStep(1);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface/78 px-4 py-6 backdrop-blur-[6px]">
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 20 }}
            className="ui-dialog flex h-[min(84vh,820px)] w-full max-w-[1120px] flex-col overflow-hidden bg-surface-container-lowest"
          >
            <div className="flex shrink-0 items-start justify-between gap-6 border-b border-on-surface/8 bg-surface px-5 py-4 lg:px-6">
              <div className="space-y-2.5">
                <div className="flex items-center gap-3">
                  <div className="inline-flex items-center gap-2 rounded-[8px] border border-primary/12 bg-primary/8 px-2.5 py-1 text-[12px] font-semibold text-primary">
                    <Layers3 className="h-3.5 w-3.5" />
                    启动配置
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={cn("h-1.5 w-7 rounded-full transition-all duration-300", step === 1 ? "bg-primary" : "bg-primary/12")} />
                    <div className={cn("h-1.5 w-7 rounded-full transition-all duration-300", step === 2 ? "bg-primary" : "bg-primary/12")} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <h2 className="text-[1.12rem] font-black font-headline tracking-tight text-on-surface leading-tight lg:text-[1.28rem]">
                    {step === 1 ? "选择本轮整理模板" : "补充这次的整理偏好"}
                  </h2>
                  <p className="max-w-2xl text-[13px] leading-6 text-ui-muted">
                    {step === 1 ? "先决定目录结构和整体风险取向，再进入扫描。" : "只保留会影响结果的关键偏好，不展开无关说明。"}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="ui-panel-muted hidden px-4 py-3 lg:block">
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

            <div className="min-h-0 flex-1 overflow-hidden px-5 py-5 lg:px-6">
              <AnimatePresence mode="wait">
                {step === 1 ? (
                  <motion.div
                    key="step-1"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    className="flex h-full flex-col overflow-hidden"
                  >
                    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[300px_minmax(0,1fr)]">
                      <div className="flex flex-col overflow-hidden rounded-[10px] border border-on-surface/8 bg-surface">
                        <div className="shrink-0 px-4 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ui-muted">整理模板群组</p>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 pt-0 space-y-1.5 scrollbar-thin">
                          {STRATEGY_TEMPLATES.map((template) => {
                            const active = strategy.template_id === template.id;
                            const defaultTag = template.defaultCautionLevel === "conservative" ? "保守" : "平衡";
                            return (
                              <button
                                key={template.id}
                                type="button"
                                disabled={loading}
                                onClick={() => onTemplateSelect(template.id)}
                                className={cn(
                                  "group relative flex w-full flex-col rounded-[8px] border px-3.5 py-3.5 text-left transition-all duration-200 disabled:opacity-50",
                                  active
                                    ? "border-primary/22 bg-primary/6 shadow-[0_8px_20px_rgba(0,0,0,0.05)]"
                                    : "border-transparent bg-surface-container-lowest hover:border-primary/16 hover:bg-white",
                                )}
                              >
                                <div className="mb-1.5 flex items-center justify-between gap-3">
                                  <p className={cn("text-[13px] font-bold tracking-tight", active ? "text-primary" : "text-on-surface")}>{template.label}</p>
                                  {active && (
                                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white">
                                      <CheckCircle2 className="h-3 w-3" />
                                    </div>
                                  )}
                                </div>
                                <p className="line-clamp-2 text-[11.5px] leading-[1.6] text-ui-muted">{template.applicableScenarios}</p>
                                <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
                                  <span className="rounded-full border border-on-surface/8 bg-surface-container-low px-2 py-0.5 text-[10px] font-medium text-on-surface-variant">
                                    {template.defaultNamingStyle === "en" ? "英文目录" : template.defaultNamingStyle === "minimal" ? "极简" : "中文目录"}
                                  </span>
                                  <span className="rounded-full border border-on-surface/8 bg-surface-container-low px-2 py-0.5 text-[10px] font-medium text-on-surface-variant">
                                    {defaultTag}
                                  </span>
                                </div>
                                {active && (
                                  <motion.div
                                    layoutId="active-indicator"
                                    className="absolute bottom-0 left-3 right-3 h-[2.5px] rounded-full bg-primary"
                                  />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex flex-col gap-4 overflow-hidden">
                        <div className="shrink-0 flex flex-col rounded-[10px] border border-on-surface/8 bg-surface-container-lowest p-5">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <span className="rounded-full border border-primary/12 bg-primary/8 px-3 py-1 text-[12px] font-semibold text-primary">{currentTemplate.label}</span>
                            <span className="rounded-full border border-on-surface/8 bg-surface-container-low px-3 py-1 text-[12px] font-medium text-on-surface-variant">{templateTag}</span>
                          </div>
                          <p className="mt-3 text-[13.5px] leading-7 text-ui-muted">{currentTemplate.description}</p>

                          <div className="mt-5 grid gap-3 sm:grid-cols-2">
                            <div className="rounded-[10px] border border-on-surface/6 bg-surface-container-low px-4 py-3">
                              <div className="text-[10.5px] font-medium uppercase tracking-widest text-ui-muted">适用场景</div>
                              <p className="mt-1.5 text-[13px] font-semibold leading-6 text-on-surface">{currentTemplate.applicableScenarios}</p>
                            </div>
                            <div className="rounded-[10px] border border-on-surface/6 bg-surface-container-low px-4 py-3">
                              <div className="text-[10.5px] font-medium uppercase tracking-widest text-ui-muted">目录风格/整理方式</div>
                              <p className="mt-1.5 text-[13px] font-semibold text-on-surface">{namingLabel} · {cautionLabel}</p>
                            </div>
                          </div>
                        </div>

                        <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-[10px] border border-on-surface/8 bg-surface">
                          <div className="shrink-0 px-4 py-3 border-b border-on-surface/6">
                            <div className="text-[11px] font-medium uppercase tracking-widest text-ui-muted">预计目录结构预览</div>
                          </div>
                          <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin">
                            {directoryPreview.map((directory, index) => (
                              <motion.div
                                initial={{ opacity: 0, x: 12 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: index * 0.06 }}
                                key={`${strategy.template_id}-${strategy.naming_style}-${directory}`}
                                className="flex items-center gap-2.5 rounded-[8px] border border-on-surface/6 bg-surface-container-lowest px-3 py-2.5 transition-colors hover:border-primary/16"
                              >
                                <div className="h-1.5 w-1.5 rounded-full bg-primary/40" />
                                <span className="text-[12.5px] font-semibold text-on-surface">{directory}</span>
                              </motion.div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="step-2"
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    className="flex h-full flex-col gap-5"
                  >
                    <div className="ui-panel-muted border-primary/12 bg-primary/5 px-5 py-3.5">
                      <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium text-primary/90">
                        <span className="rounded-full border border-primary/12 bg-white/70 px-3 py-1">{currentTemplate.label}</span>
                        <span className="rounded-full border border-primary/12 bg-white/70 px-3 py-1">{namingLabel}</span>
                        <span className="rounded-full border border-primary/12 bg-white/70 px-3 py-1">{cautionLabel}</span>
                        <p className="ml-2 text-[12.5px] leading-6 text-primary/80">
                          补充本轮偏好后，即可进入“扫描 → 预检 → 执行确认”流程。
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 min-h-0 flex-1">
                      <div className="flex flex-col gap-5">
                        <div className="rounded-[8px] border border-on-surface/8 bg-surface-container-lowest p-4">
                          <div className="mb-3 flex items-center justify-between">
                            <span className="text-[11px] font-medium uppercase tracking-widest text-ui-muted">目录命名风格</span>
                          </div>
                          <div className="grid grid-cols-3 gap-2.5">
                            {NAMING_STYLE_OPTIONS.map((option) => {
                              const active = strategy.naming_style === option.id;
                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  disabled={loading}
                                  onClick={() => onChangeNaming(option.id)}
                                  className={cn(
                                    "flex flex-col rounded-[10px] border px-3 py-3 text-left transition-all duration-200 disabled:opacity-50",
                                    active ? "border-primary/25 bg-primary/6 shadow-[0_2px_10px_rgba(0,0,0,0.04)]" : "border-on-surface/8 bg-surface-container-low hover:border-primary/16",
                                  )}
                                >
                                  <div className="mb-1.5 flex items-center justify-between w-full">
                                    <p className={cn("text-[13px] font-bold tracking-tight", active ? "text-primary" : "text-on-surface")}>{option.label}</p>
                                    {active && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                                  </div>
                                  <p className="text-[11px] leading-[1.5] text-ui-muted">{option.description}</p>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="rounded-[8px] border border-on-surface/8 bg-surface-container-lowest p-4">
                          <div className="mb-3 flex items-center justify-between">
                            <span className="text-[11px] font-medium uppercase tracking-widest text-ui-muted">整理方式</span>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            {CAUTION_LEVEL_OPTIONS.map((option) => {
                              const active = strategy.caution_level === option.id;
                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  disabled={loading}
                                  onClick={() => onChangeCaution(option.id)}
                                  className={cn(
                                    "flex flex-col rounded-[10px] border px-3.5 py-3 text-left transition-all duration-200 disabled:opacity-50",
                                    active ? "border-primary/25 bg-primary/6 shadow-[0_2px_10px_rgba(0,0,0,0.04)]" : "border-on-surface/8 bg-surface-container-low hover:border-primary/16",
                                  )}
                                >
                                  <div className="mb-1.5 flex items-center justify-between w-full">
                                    <p className={cn("text-[13px] font-bold tracking-tight", active ? "text-primary" : "text-on-surface")}>{option.label}</p>
                                    {active && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                                  </div>
                                  <p className="text-[11px] leading-[1.5] text-ui-muted">{option.description}</p>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col rounded-[8px] border border-on-surface/8 bg-surface-container-lowest p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <span className="text-[11px] font-medium uppercase tracking-widest text-ui-muted">补充说明</span>
                          <span className="text-[10px] font-semibold text-ui-muted bg-surface-container-low px-2 py-0.5 rounded-full">可选</span>
                        </div>
                        <textarea
                          value={strategy.note}
                          disabled={loading}
                          onChange={(event) => onChangeNote(event.target.value.slice(0, 200))}
                          placeholder="例如：项目文件尽量放在一起；拿不准的先放 Review。"
                          className="flex-1 w-full resize-none rounded-[10px] border border-on-surface/8 bg-surface-container-low px-4 py-3.5 text-[13.5px] leading-relaxed text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary/30 focus:bg-white focus:ring-4 focus:ring-primary/5 disabled:opacity-50"
                        />
                        <div className="mt-3 flex items-start gap-3 rounded-[8px] border border-primary/10 bg-primary/4 p-3">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-white text-primary shadow-sm border border-primary/10">
                             <Sparkles className="h-4 w-4" />
                          </div>
                          <p className="text-[11.5px] leading-snug text-primary/85 pt-0.5">
                            这些说明会作为本轮偏好参考，适合补充“拿不准的先放 Review”之类的整体规则。
                          </p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="shrink-0 border-t border-on-surface/8 bg-surface-container-low px-5 py-4 lg:px-6">
              <div className="ui-panel-muted flex flex-wrap items-center justify-between gap-4 px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="text-[12px] font-medium text-ui-muted">当前选择</div>
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
                        {loading ? "正在启动扫描" : "确认并开始扫描"}
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
  const [savedLaunchStrategy, setSavedLaunchStrategy] = useState<SessionStrategySelection>(DEFAULT_STRATEGY_SELECTION);
  const [draftStrategy, setDraftStrategy] = useState<SessionStrategySelection>(DEFAULT_STRATEGY_SELECTION);
  const [launchSkipPrompt, setLaunchSkipPrompt] = useState(false);
  const [launchPreferencesLoaded, setLaunchPreferencesLoaded] = useState(false);
  const [effectiveLaunchStrategy, setEffectiveLaunchStrategy] = useState<SessionStrategySelection>(DEFAULT_STRATEGY_SELECTION);
  const [loading, setLoading] = useState(false);
  const [launchTransitionOpen, setLaunchTransitionOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resumePrompt, setResumePrompt] = useState<{ sessionId: string; snapshot: SessionSnapshot } | null>(null);

  const resumeStrategy = resumePrompt?.snapshot.strategy || DEFAULT_STRATEGY_SUMMARY;
  const resumeStage = resumePrompt?.snapshot.stage;
  const isCompletedResume = resumeStage === "completed";
  const currentSummary = buildStrategySummary(savedLaunchStrategy);
  const currentTemplate = getTemplateMeta(savedLaunchStrategy.template_id);
  const namingLabel = currentSummary.naming_style_label;
  const cautionLabel = currentSummary.caution_level_label;

  useEffect(() => {
    let cancelled = false;

    async function loadLaunchPreferences() {
      try {
        const api = createApiClient(apiBaseUrl, getApiToken());
        const data = await api.getSettings();
        if (cancelled) {
          return;
        }
        const strategy = getLaunchStrategyFromConfig(data.global_config);
        setSavedLaunchStrategy(strategy);
        setDraftStrategy(strategy);
        setEffectiveLaunchStrategy(strategy);
        setLaunchSkipPrompt(shouldSkipLaunchStrategyPrompt(data.global_config));
        setLaunchPreferencesLoaded(true);
      } catch {
        if (cancelled) {
          return;
        }
        setSavedLaunchStrategy(DEFAULT_STRATEGY_SELECTION);
        setDraftStrategy(DEFAULT_STRATEGY_SELECTION);
        setEffectiveLaunchStrategy(DEFAULT_STRATEGY_SELECTION);
        setLaunchSkipPrompt(false);
        setLaunchPreferencesLoaded(true);
      }
    }

    void loadLaunchPreferences();

    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

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
    setDraftStrategy(savedLaunchStrategy);
    setStrategyDialogOpen(true);
  }

  function handleTemplateSelect(templateId: SessionStrategySelection["template_id"]) {
    const suggested = getSuggestedSelection(templateId);
    setDraftStrategy((prev) => ({
      ...prev,
      template_id: templateId,
      naming_style: suggested.naming_style,
      caution_level: suggested.caution_level,
    }));
  }

  async function launchWithStrategy(strategy: SessionStrategySelection) {
    if (!targetDir.trim()) return;
    setLoading(true);
    setLaunchTransitionOpen(true);
    setError(null);
    setEffectiveLaunchStrategy(strategy);
    try {
      const api = createApiClient(apiBaseUrl, getApiToken());
      const response = await createSessionAndStartScan(api, targetDir, true, strategy);
      if (response.mode === "resume_available" && response.restorable_session?.session_id) {
        setLaunchTransitionOpen(false);
        setResumePrompt({
          sessionId: response.restorable_session.session_id,
          snapshot: response.restorable_session,
        });
        return;
      }
      if (!response.session_id) {
        throw new Error("没有成功创建整理会话，请再试一次。");
      }
      setStrategyDialogOpen(false);
      router.push(`/workspace?session_id=${response.session_id}&dir=${encodeURIComponent(targetDir)}`);
    } catch (err: any) {
      setLaunchTransitionOpen(false);
      if (err.message && err.message.toLowerCase().includes("failed to fetch")) {
        setError(`现在连不上本地服务，请确认它是否已经启动（${apiBaseUrl}）。`);
      } else {
        setError(err instanceof Error ? err.message : "创建会话或启动扫描失败，请再试一次。");
      }
    } finally {
      if (!resumePrompt) {
        setLoading(false);
      }
    }
  }

  async function handlePrimaryLaunch() {
    if (launchSkipPrompt) {
      await launchWithStrategy(savedLaunchStrategy);
      return;
    }
    openStrategyDialog();
  }

  async function handleStartFresh() {
    if (!resumePrompt) return;
    setLoading(true);
    setLaunchTransitionOpen(true);
    setError(null);
    try {
      const api = createApiClient(apiBaseUrl, getApiToken());
      const response = await startFreshSession(
        api,
        resumePrompt.sessionId,
        targetDir,
        effectiveLaunchStrategy,
        resumePrompt.snapshot.stage,
      );
      setResumePrompt(null);
      if (!response.session_id) {
        throw new Error("没有成功重新开始，请再试一次。");
      }
      router.push(`/workspace?session_id=${response.session_id}&dir=${encodeURIComponent(targetDir)}`);
    } catch (err: any) {
      setLaunchTransitionOpen(false);
      if (err.message && err.message.toLowerCase().includes("failed to fetch")) {
        setError(`现在连不上本地服务，请确认它是否已经启动（${apiBaseUrl}）。`);
      } else {
        setError(err instanceof Error ? err.message : "重新开始并启动扫描失败，请再试一次。");
      }
    } finally {
      setLoading(false);
    }
  }

  function handleCancelResume() {
    setResumePrompt(null);
    setLaunchTransitionOpen(false);
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
      <LaunchTransitionOverlay open={launchTransitionOpen} targetDir={targetDir} />
      <div className="mx-auto flex min-h-full w-full max-w-[1220px] items-center px-4 py-6 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="w-full"
        >
          <section className="overflow-hidden rounded-[12px] border border-on-surface/8 bg-surface-container-lowest px-5 py-6 shadow-[0_18px_44px_rgba(0,0,0,0.05)] sm:px-7 sm:py-7">
            <div className="mx-auto max-w-[980px] space-y-7">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 rounded-full border border-primary/12 bg-primary/8 px-3 py-1 text-[12px] font-semibold text-primary">
                  <Sparkles className="h-4 w-4" />
                  New Task Console
                </div>
                <div className="space-y-2.5">
                  <h1 className="max-w-3xl text-[1.9rem] font-black font-headline leading-[1.02] tracking-tight text-on-surface sm:text-[2.4rem] lg:text-[2.9rem]">
                    选择目录并开始整理
                  </h1>
                  <p className="max-w-2xl text-[14px] leading-7 text-ui-subtle sm:text-[15px]">
                    这里负责启动任务。系统会先扫描、再给方案、再进入预检，真正执行前仍需要你确认。
                  </p>
                </div>
              </div>

              <div className="rounded-[12px] border border-on-surface/8 bg-surface px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
                <div className="grid gap-3 lg:grid-cols-[56px_minmax(0,1fr)_auto] lg:items-center">
                  <Button
                    variant="ghost"
                    onClick={handleSelectDir}
                    disabled={loading}
                    className="h-12 w-12 rounded-[10px] p-0 text-ui-muted hover:bg-primary/6 hover:text-primary"
                    title="浏览文件夹"
                  >
                    <FolderOpen className="h-5 w-5" />
                  </Button>
                  <div className="min-w-0 border-l border-r border-on-surface/6 px-1 lg:px-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ui-muted">Target Directory</div>
                    <input
                      value={targetDir}
                      onChange={(event) => setTargetDir(event.target.value)}
                      disabled={loading}
                      className="mt-1 h-12 w-full min-w-0 bg-transparent pr-3 text-[16px] font-semibold tracking-tight text-on-surface outline-none placeholder:text-on-surface-variant/32 disabled:opacity-70"
                      placeholder="粘贴路径或点击左侧图标选择目录..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handlePrimaryLaunch();
                      }}
                    />
                  </div>
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={() => void handlePrimaryLaunch()}
                    disabled={loading || !targetDir.trim()}
                    loading={loading}
                    className="w-full px-7 lg:min-w-[190px]"
                  >
                    {loading ? "正在准备" : "开始扫描整理"}
                    {!loading && <ArrowRight className="h-4.5 w-4.5" />}
                  </Button>
                </div>
              </div>

              <div className="rounded-[10px] border border-on-surface/8 bg-surface px-4 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-on-surface">
                    <span className="text-ui-muted">当前预设</span>
                    {launchPreferencesLoaded ? (
                      <>
                        <span className="ui-pill border-primary/12 bg-primary/8 text-primary">{currentTemplate.label}</span>
                        <span className="ui-pill">{namingLabel}</span>
                        <span className="ui-pill">{cautionLabel}</span>
                      </>
                    ) : (
                      <span className="ui-pill">正在读取</span>
                    )}
                  </div>
                  <p className="text-[13px] leading-6 text-ui-subtle">
                    {launchPreferencesLoaded
                      ? launchSkipPrompt
                        ? "点击开始后会直接按这组预设创建并扫描新任务。"
                        : "点击开始后会先打开策略确认窗口，并以这组预设作为默认起点。"
                      : "正在同步当前配置方案的启动预设。"}
                  </p>
                </div>
                  <div className="grid gap-2 text-[12px] text-ui-muted sm:grid-cols-3">
                    <div className="rounded-[8px] border border-on-surface/6 bg-surface-container-low px-3 py-2.5">先扫描再出方案</div>
                    <div className="rounded-[8px] border border-on-surface/6 bg-surface-container-low px-3 py-2.5">执行前仍需确认</div>
                    <div className="rounded-[8px] border border-on-surface/6 bg-surface-container-low px-3 py-2.5">支持最近一次回退</div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </motion.div>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="mt-4"
            >
              <div className="rounded-[10px] border border-error/14 bg-error-container/14 px-5 py-4 text-[14px] font-semibold text-error">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" />
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
        strategy={draftStrategy}
        onClose={() => setStrategyDialogOpen(false)}
        onConfirm={() => void launchWithStrategy(draftStrategy)}
        onTemplateSelect={handleTemplateSelect}
        onChangeNaming={(id) => setDraftStrategy((prev) => ({ ...prev, naming_style: id }))}
        onChangeCaution={(id) => setDraftStrategy((prev) => ({ ...prev, caution_level: id }))}
        onChangeNote={(value) => setDraftStrategy((prev) => ({ ...prev, note: value }))}
      />

      <AnimatePresence>
        {resumePrompt && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-surface/78 backdrop-blur-md p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="ui-dialog w-full max-w-[760px] bg-surface-container-lowest p-6 sm:p-7"
            >
              <div className="mb-6 flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-[8px] border border-primary/12 bg-primary/10 text-primary">
                  <History className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-xl font-black font-headline text-on-surface tracking-tight">
                    {isCompletedResume ? "发现之前的整理记录" : "发现上一次还没整理完"}
                  </h2>
                  <p className="text-ui-body font-medium text-ui-muted">
                    {isCompletedResume
                      ? "你可以先查看之前的结果，也可以按这次的预设重新开始"
                      : "你可以继续上一次任务，或者按这次的预设重新开始"}
                  </p>
                </div>
              </div>

              <p className="mb-5 text-sm leading-relaxed text-on-surface-variant">
                检测到这个目录（<strong>{targetDir.split(/[\\/]/).pop()}</strong>）
                {isCompletedResume ? "之前已经整理过一次" : "之前还有一条未完成的记录"}（当前状态：
                <em>{STAGE_LABELS[resumePrompt.snapshot.stage] || resumePrompt.snapshot.stage}</em>）。
              </p>

              <div className="mb-6 rounded-[10px] border border-on-surface/8 bg-surface px-5 py-5">
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
                <div className="rounded-[10px] border border-on-surface/8 bg-surface px-5 py-4 text-ui-section font-medium leading-relaxed text-ui-muted">
                  {isCompletedResume
                    ? "重新开始会按这次实际提交的策略重新扫描这个目录。"
                    : "重新开始会放弃上一次未完成的状态，并按这次实际提交的策略重新扫描。"}
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
                    只读打开
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
