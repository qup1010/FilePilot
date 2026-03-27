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
                    {step === 1 ? "先确定这次整理会按哪种目录结构和风险偏好生成初始方案。" : "再补充命名风格、整理保守度和你的个人偏好。"}
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
                    className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]"
                  >
                    <div className="space-y-4">
                      <div className="px-1 text-[12px] font-medium text-ui-muted">可选模板</div>
                      <div className="space-y-3">
                        {STRATEGY_TEMPLATES.map((template) => {
                          const active = strategy.template_id === template.id;
                          const defaultTag = template.defaultCautionLevel === "conservative" ? "保守" : "平衡";
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
                              <div className="mb-2 flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className={cn("text-[14px] font-semibold tracking-tight", active ? "text-primary" : "text-on-surface")}>{template.label}</p>
                                  <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-ui-muted">{template.applicableScenarios}</p>
                                </div>
                                {active && (
                                   <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white">
                                     <CheckCircle2 className="h-3.5 w-3.5" />
                                   </div>
                                )}
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <span className="rounded-full border border-on-surface/8 bg-surface-container-low px-2.5 py-1 text-[11px] font-medium text-on-surface-variant">
                                  {template.defaultNamingStyle === "en" ? "英文目录优先" : template.defaultNamingStyle === "minimal" ? "极简目录" : "中文目录优先"}
                                </span>
                                <span className="rounded-full border border-on-surface/8 bg-surface-container-low px-2.5 py-1 text-[11px] font-medium text-on-surface-variant">
                                  {defaultTag}
                                </span>
                              </div>
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
                        <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                          <div className="space-y-7">
                            <div className="space-y-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-primary/12 bg-primary/8 px-3 py-1 text-[12px] font-semibold text-primary">
                                  当前模板
                                </span>
                                <span className="rounded-full border border-on-surface/8 bg-surface-container-low px-3 py-1 text-[12px] font-medium text-on-surface-variant">
                                  {templateTag}
                                </span>
                              </div>
                              <h3 className="text-[1.32rem] font-black font-headline tracking-tight text-on-surface lg:text-[1.45rem]">{currentTemplate.label}</h3>
                              <p className="max-w-xl text-[14px] leading-7 text-ui-muted">{currentTemplate.description}</p>
                            </div>

                            <div className="grid gap-4 lg:grid-cols-2">
                              <div className="rounded-[10px] border border-on-surface/8 bg-surface-container-low px-5 py-4">
                                <div className="text-[12px] font-medium text-ui-muted">适用场景</div>
                                <p className="mt-3 text-[14px] leading-7 text-on-surface">{currentTemplate.applicableScenarios}</p>
                              </div>
                              <div className="rounded-[10px] border border-on-surface/8 bg-surface-container-low px-5 py-4">
                                <div className="text-[12px] font-medium text-ui-muted">预计整理风格</div>
                                <p className="mt-3 text-[14px] leading-7 text-on-surface">
                                  会优先按 {currentTemplate.label} 的目录骨架生成第一版整理方案，不会直接移动文件。
                                </p>
                              </div>
                            </div>

                            <div className="grid gap-4 lg:grid-cols-2">
                              <div className="rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-4">
                                <div className="text-[12px] font-medium text-ui-muted">命名风格</div>
                                <p className="mt-2 text-[14px] font-semibold text-on-surface">{namingLabel}</p>
                              </div>
                              <div className="rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-4">
                                <div className="text-[12px] font-medium text-ui-muted">整理方式</div>
                                <p className="mt-2 text-[14px] font-semibold text-on-surface">{cautionLabel}</p>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-[12px] border border-on-surface/8 bg-surface-container-low p-5">
                            <div className="mb-4 text-[12px] font-medium text-ui-muted">预计目录结构片段</div>
                            <div className="space-y-3">
                              {directoryPreview.map((directory, index) => (
                                <motion.div
                                  initial={{ opacity: 0, x: 20 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ delay: index * 0.1 }}
                                  key={`${strategy.template_id}-${strategy.naming_style}-${directory}`}
                                  className="flex items-center gap-3 rounded-[10px] border border-on-surface/8 bg-surface-container-lowest px-4 py-3 transition-colors hover:border-primary/16"
                                >
                                  <div className="h-2 w-2 rounded-full bg-primary/30" />
                                  <span className="text-[13px] font-semibold text-on-surface">{directory}</span>
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
                          这一页只是在确定第一版整理方式。真正移动文件前，后面还会进入预检和最终确认。
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
                      <div className="rounded-[12px] border border-primary/12 bg-primary/6 px-5 py-4">
                        <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium text-primary/90">
                          <span className="rounded-full border border-primary/12 bg-white/70 px-3 py-1">{currentTemplate.label}</span>
                          <span className="rounded-full border border-primary/12 bg-white/70 px-3 py-1">{namingLabel}</span>
                          <span className="rounded-full border border-primary/12 bg-white/70 px-3 py-1">{cautionLabel}</span>
                        </div>
                        <p className="mt-3 text-[13px] leading-6 text-primary/85">
                          第二步只是在第一步模板基础上补充你的偏好，不会改变“先扫描、后生成方案、最后确认执行”的主流程。
                        </p>
                      </div>

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
                            这些说明会作为整理偏好一起参考，尤其适合“项目文件放一起”“不确定项先进 Review”这类额外要求。
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
  const [savedLaunchStrategy, setSavedLaunchStrategy] = useState<SessionStrategySelection>(DEFAULT_STRATEGY_SELECTION);
  const [draftStrategy, setDraftStrategy] = useState<SessionStrategySelection>(DEFAULT_STRATEGY_SELECTION);
  const [launchSkipPrompt, setLaunchSkipPrompt] = useState(false);
  const [launchPreferencesLoaded, setLaunchPreferencesLoaded] = useState(false);
  const [effectiveLaunchStrategy, setEffectiveLaunchStrategy] = useState<SessionStrategySelection>(DEFAULT_STRATEGY_SELECTION);
  const [loading, setLoading] = useState(false);
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
        const data = await api.getConfig();
        if (cancelled) {
          return;
        }
        const strategy = getLaunchStrategyFromConfig(data.config);
        setSavedLaunchStrategy(strategy);
        setDraftStrategy(strategy);
        setEffectiveLaunchStrategy(strategy);
        setLaunchSkipPrompt(shouldSkipLaunchStrategyPrompt(data.config));
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
    setError(null);
    setEffectiveLaunchStrategy(strategy);
    try {
      const api = createApiClient(apiBaseUrl, getApiToken());
      const response = await createSessionAndStartScan(api, targetDir, true, strategy);
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
      setStrategyDialogOpen(false);
      router.push(`/workspace?session_id=${response.session_id}&dir=${encodeURIComponent(targetDir)}`);
    } catch (err: any) {
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
      <div className="mx-auto w-full max-w-4xl py-6 sm:py-8 lg:py-12 xl:py-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: "easeOut" }}
          className="mb-6 flex flex-col items-center text-center sm:mb-8 lg:mb-10"
        >
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-[13px] font-black text-primary shadow-sm sm:mb-5 lg:mb-6">
            <Sparkles className="h-4 w-4" />
            新建整理任务
          </div>
          <h1 className="mb-4 text-3xl font-black font-headline tracking-tight text-on-surface sm:text-4xl lg:mb-5 lg:text-6xl">
            先选目录，再开始整理
          </h1>
          <p className="max-w-3xl text-[15px] font-medium leading-relaxed text-ui-muted sm:text-base lg:text-lg">
            先扫描目录，再生成整理方案；确认后才会真正移动文件。
            <br className="hidden sm:block" />
            支持预检与回退，首页只保留最直接的开始路径。
          </p>
        </motion.div>

        <div className="space-y-4 sm:space-y-5 lg:space-y-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.12, duration: 0.35 }}
            className="rounded-[28px] border border-on-surface/10 bg-surface-container-lowest p-4 shadow-[0_20px_50px_rgba(0,0,0,0.06)]"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
              <div className="relative flex min-w-0 flex-1 items-center rounded-[22px] border border-on-surface/8 bg-surface-container-low px-2 focus-within:border-primary/30 focus-within:ring-4 focus-within:ring-primary/5">
                <Button
                  variant="ghost"
                  onClick={handleSelectDir}
                  disabled={loading}
                  className="h-12 w-12 rounded-[14px] p-0 text-ui-muted transition-all hover:bg-primary/5 hover:text-primary active:scale-90"
                  title="浏览文件夹"
                >
                  <FolderOpen className="h-6 w-6" />
                </Button>
                <input
                  value={targetDir}
                  onChange={(event) => setTargetDir(event.target.value)}
                  disabled={loading}
                  className="h-16 w-full min-w-0 bg-transparent pr-4 text-[17px] font-bold text-on-surface outline-none placeholder:text-on-surface-variant/25 disabled:opacity-70"
                  placeholder="粘贴路径或点击左侧图标选择目录..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handlePrimaryLaunch();
                  }}
                />
              </div>
              <Button
                variant="primary"
                onClick={() => void handlePrimaryLaunch()}
                disabled={loading || !targetDir.trim()}
                loading={loading}
                className="h-16 rounded-[20px] px-10 text-[17px] font-black tracking-tight shadow-[0_8px_25px_rgba(var(--primary-rgb),0.3)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(var(--primary-rgb),0.4)] active:translate-y-0.5 active:scale-[0.98]"
              >
                {loading ? "正在准备" : "开始扫描整理"}
                {!loading && <ArrowRight className="ml-2 h-5 w-5" />}
              </Button>
            </div>

            <div className="mt-4 rounded-[20px] border border-on-surface/6 bg-surface-container-low px-4 py-4">
              <div className="space-y-2">
                {launchPreferencesLoaded ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-on-surface">
                      <span className="text-ui-muted">当前预设</span>
                      <span className="rounded-full border border-primary/12 bg-primary/8 px-3 py-1 text-[12px] font-semibold text-primary">
                        {currentTemplate.label}
                      </span>
                      <span className="rounded-full border border-on-surface/8 bg-surface-container-lowest px-3 py-1 text-[12px] font-medium text-on-surface-variant">
                        {namingLabel}
                      </span>
                      <span className="rounded-full border border-on-surface/8 bg-surface-container-lowest px-3 py-1 text-[12px] font-medium text-on-surface-variant">
                        {cautionLabel}
                      </span>
                    </div>
                    <p className="text-[13px] leading-6 text-ui-muted">
                      {launchSkipPrompt
                        ? "点击开始后，会直接用这组预设创建并扫描新任务。"
                        : "点击开始后，会先让你确认这次整理策略；弹窗会以这组预设作为起点。"}
                    </p>
                  </>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-on-surface">
                      <span className="text-ui-muted">当前预设</span>
                      <span className="rounded-full border border-on-surface/8 bg-surface-container-lowest px-3 py-1 text-[12px] font-medium text-on-surface-variant">
                        正在读取
                      </span>
                    </div>
                    <p className="text-[13px] leading-6 text-ui-muted">正在同步当前配置方案的启动预设。</p>
                  </>
                )}
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.3 }}
            className="grid gap-3 sm:grid-cols-3"
          >
            <div className="rounded-[18px] border border-on-surface/8 bg-surface-container-lowest px-4 py-4">
              <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-on-surface">
                <FolderOpen className="h-4 w-4 text-primary" />
                选择目录
              </div>
              <p className="text-[13px] leading-6 text-ui-muted">支持粘贴路径，也可以直接唤起目录选择器。</p>
            </div>
            <div className="rounded-[18px] border border-on-surface/8 bg-surface-container-lowest px-4 py-4">
              <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-on-surface">
                <Sparkles className="h-4 w-4 text-primary" />
                先出方案
              </div>
              <p className="text-[13px] leading-6 text-ui-muted">系统会先扫描并给出整理建议，确认后才进入执行阶段。</p>
            </div>
            <div className="rounded-[18px] border border-on-surface/8 bg-surface-container-lowest px-4 py-4">
              <div className="mb-2 flex items-center gap-2 text-[13px] font-bold text-on-surface">
                <ShieldCheck className="h-4 w-4 text-primary" />
                预检与回退
              </div>
              <p className="text-[13px] leading-6 text-ui-muted">执行前会预检，完成后仍支持最近一次回退。</p>
            </div>
          </motion.div>
        </div>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="mt-8"
            >
              <div className="flex items-start gap-4 rounded-[20px] border border-error/15 bg-error-container/10 px-5 py-4 text-[14px] font-bold text-error shadow-sm backdrop-blur-sm">
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
                      ? "你可以先看看之前的结果，也可以按这次的预设重新开始"
                      : "你可以继续上一次，或者按这次的预设重新开始"}
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
