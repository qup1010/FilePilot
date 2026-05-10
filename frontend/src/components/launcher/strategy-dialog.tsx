import { useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Layers3, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  buildStrategySummary,
  CAUTION_LEVEL_OPTIONS,
  DENSITY_OPTIONS,
  getTemplateMeta,
  LANGUAGE_OPTIONS,
  PREFIX_STYLE_OPTIONS,
  STRATEGY_TEMPLATES,
} from "@/lib/strategy-templates";
import { SessionStrategySelection } from "@/types/session";

export function StrategyDialog({
  open,
  loading,
  error,
  targetDir,
  strategy,
  onClose,
  onConfirm,
  onTemplateSelect,
  onChangeLanguage,
  onChangeDensity,
  onChangePrefixStyle,
  onChangeCaution,
  onChangeOrganizeMode,
  onChangeNote,
}: {
  open: boolean;
  loading: boolean;
  error?: string | null;
  targetDir: string;
  strategy: SessionStrategySelection;
  onClose: () => void;
  onConfirm: () => void;
  onTemplateSelect: (templateId: SessionStrategySelection["template_id"]) => void;
  onChangeLanguage: (id: SessionStrategySelection["language"]) => void;
  onChangeDensity: (id: SessionStrategySelection["density"]) => void;
  onChangePrefixStyle: (id: SessionStrategySelection["prefix_style"]) => void;
  onChangeCaution: (id: SessionStrategySelection["caution_level"]) => void;
  onChangeOrganizeMode: (mode: SessionStrategySelection["organize_mode"]) => void;
  onChangeNote: (value: string) => void;
}) {
  const isIncremental = strategy.organize_mode === "incremental";
  const currentTemplate = useMemo(() => getTemplateMeta(strategy.template_id), [strategy.template_id]);
  const summary = useMemo(() => buildStrategySummary(strategy), [strategy]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface/78 px-4 py-6 backdrop-blur-[6px]">
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 20 }}
            className="ui-dialog flex h-[min(92vh,820px)] w-full max-w-[1080px] flex-col overflow-hidden bg-surface-container-lowest"
          >
            <div className="flex items-start justify-between gap-6 border-b border-on-surface/8 bg-surface px-5 py-3 lg:px-6">
              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-1.5 rounded-[6px] border border-primary/12 bg-primary/8 px-2 py-0.5 text-[11px] font-bold text-primary">
                  <Layers3 className="h-3 w-3" />
                  启动配置
                </div>
                <div className="space-y-0.5">
                  <h2 className="text-[1.1rem] font-black tracking-tight text-on-surface">补充本轮整理策略</h2>
                  <p className="max-w-2xl text-[12px] leading-relaxed text-ui-muted">
                    {isIncremental
                      ? "确认本轮将使用显式目标目录配置，随后进入扫描与规划。"
                      : "完成模板、命名和整理偏好设置，随后进入 AI 扫描分析。"}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="ui-panel-muted hidden px-3.5 py-2.5 lg:block">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-ui-muted/60">目标目录</div>
                  <p className="mt-0.5 max-w-[260px] truncate font-mono text-[11px] font-medium text-on-surface" title={targetDir}>{targetDir}</p>
                </div>
                <Button variant="secondary" size="sm" onClick={onClose} className="h-9 w-9 rounded-[8px] p-0" title="关闭">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-5 py-4 lg:px-6 bg-surface-container-lowest/30">
              {error ? (
                <div className="mb-4 rounded-[10px] border border-error/14 bg-error-container/14 px-4 py-3 text-error">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="mt-0.5 h-4.5 w-4.5 shrink-0" />
                    <p className="text-[12.5px] font-semibold leading-relaxed">{error}</p>
                  </div>
                </div>
              ) : null}
              <div className={cn("grid gap-4", isIncremental ? "lg:grid-cols-1" : "lg:grid-cols-[260px_minmax(0,1fr)]")}>
                {!isIncremental ? (
                  <section className="rounded-[10px] border border-on-surface/8 bg-surface p-3">
                    <div className="mb-2 px-1">
                      <p className="text-[10.5px] font-bold uppercase tracking-[0.15em] text-ui-muted">整理模板</p>
                    </div>
                    <div className="space-y-1.5">
                      {STRATEGY_TEMPLATES.map((template) => {
                        const active = strategy.template_id === template.id;
                        return (
                          <button
                            key={template.id}
                            type="button"
                            onClick={() => onTemplateSelect(template.id)}
                            disabled={loading}
                            className={cn(
                              "flex w-full flex-col rounded-[8px] border px-3 py-2.5 text-left transition-all disabled:opacity-50",
                              active ? "border-primary/25 bg-primary/10" : "border-transparent bg-surface-container-lowest hover:border-primary/20 hover:bg-surface-container-low",
                            )}
                          >
                            <div className="mb-1 flex items-center justify-between gap-3">
                              <p className={cn("text-[13px] font-bold tracking-tight", active ? "text-primary" : "text-on-surface")}>{template.label}</p>
                              {active ? <CheckCircle2 className="h-4 w-4 text-primary" /> : null}
                            </div>
                            <p className="text-[11px] leading-[1.5] text-ui-muted">{template.applicableScenarios}</p>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                ) : null}

                <section className="space-y-4">
                  <div className="rounded-[10px] border border-on-surface/8 bg-surface-container-lowest p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {!isIncremental ? (
                        <>
                          <span className="rounded-full border border-primary/12 bg-primary/8 px-2.5 py-0.5 text-[11px] font-bold text-primary">{currentTemplate.label}</span>
                          <span className="rounded-full border border-on-surface/8 bg-surface px-2.5 py-0.5 text-[11px] font-medium text-on-surface-variant/70">{summary.language_label}</span>
                          <span className="rounded-full border border-on-surface/8 bg-surface px-2.5 py-0.5 text-[11px] font-medium text-on-surface-variant/70">{summary.density_label}</span>
                          <span className="rounded-full border border-on-surface/8 bg-surface px-2.5 py-0.5 text-[11px] font-medium text-on-surface-variant/70">{summary.prefix_style_label}</span>
                          <span className="rounded-full border border-on-surface/8 bg-surface px-2.5 py-0.5 text-[11px] font-medium text-on-surface-variant/70">{summary.caution_level_label}</span>
                        </>
                      ) : (
                        <>
                          <span className="rounded-full border border-primary/12 bg-primary/8 px-2.5 py-0.5 text-[11px] font-bold text-primary">{summary.organize_mode_label}</span>
                          <span className="rounded-full border border-on-surface/8 bg-surface px-2.5 py-0.5 text-[11px] font-medium text-on-surface-variant/70">显式目标目录</span>
                          <span className="rounded-full border border-on-surface/8 bg-surface px-2.5 py-0.5 text-[11px] font-medium text-on-surface-variant/70">{summary.caution_level_label}</span>
                        </>
                      )}
                    </div>
                    <p className="mt-2.5 text-[13px] leading-relaxed text-ui-muted">
                      {isIncremental
                        ? "本模式只会使用你显式选择或手动添加的目标目录；拿不准的项目会进入待确认区，不会自动创建未知目标目录。"
                        : currentTemplate.description}
                    </p>

                    {!isIncremental ? (
                      <div className="mt-4 rounded-[10px] border border-on-surface/8 bg-surface px-3.5 py-2.5">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ui-muted/60">预计目录结构</div>
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {summary.preview_directories?.map((directory) => (
                            <span key={`${strategy.template_id}-${strategy.language}-${strategy.density}-${strategy.prefix_style}-${directory}`} className="rounded-[4px] border border-on-surface/8 bg-surface-container-lowest px-2 py-0.5 text-[11px] font-semibold text-on-surface">
                              {directory}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 rounded-[10px] border border-on-surface/8 bg-surface px-3.5 py-2.5">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ui-muted/60">归入已有目录约束</div>
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {[
                            "先选择目标目录",
                            "每个目录单独授权",
                            "只归入显式目标目录",
                            "拿不准进入待确认区",
                          ].map((rule) => (
                            <span key={rule} className="rounded-[4px] border border-on-surface/8 bg-surface-container-lowest px-2 py-0.5 text-[11px] font-semibold text-on-surface">
                              {rule}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="rounded-[10px] border border-on-surface/8 bg-surface p-3.5 xl:col-span-2">
                      <div className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.15em] text-ui-muted">任务类型</div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {[
                          {
                            id: "initial" as const,
                            label: "整理整个目录",
                            description: "适合整体整理当前目录，可新建目标目录。",
                          },
                          {
                            id: "incremental" as const,
                            label: "归入已有目录",
                            description: "使用显式配置的目标目录，不自动扩展子目录。",
                          },
                        ].map((option) => {
                          const active = strategy.organize_mode === option.id;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => onChangeOrganizeMode(option.id)}
                              disabled={loading}
                              className={cn(
                                "rounded-[8px] border px-3 py-2.5 text-left transition-all disabled:opacity-50",
                                active ? "border-primary/25 bg-primary/10" : "border-on-surface/8 bg-surface-container-lowest hover:border-primary/20 hover:bg-surface-container-low",
                              )}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <p className={cn("text-[12.5px] font-bold", active ? "text-primary" : "text-on-surface")}>{option.label}</p>
                                {active ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> : null}
                              </div>
                              <p className="mt-0.5 text-[11px] leading-[1.5] text-ui-muted/80">{option.description}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {!isIncremental ? (
                      <>
                        <div className="rounded-[10px] border border-on-surface/8 bg-surface p-3.5">
                          <div className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.15em] text-ui-muted">目录语言</div>
                          <div className="grid gap-1.5">
                            {LANGUAGE_OPTIONS.map((option) => {
                              const active = strategy.language === option.id;
                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => onChangeLanguage(option.id)}
                                  disabled={loading}
                                  className={cn(
                                    "rounded-[8px] border px-3 py-2 text-left transition-all disabled:opacity-50",
                                    active ? "border-primary/25 bg-primary/10" : "border-on-surface/8 bg-surface-container-lowest hover:border-primary/20 hover:bg-surface-container-low",
                                  )}
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <p className={cn("text-[12.5px] font-bold", active ? "text-primary" : "text-on-surface")}>{option.label}</p>
                                    {active ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> : null}
                                  </div>
                                  <p className="mt-0.5 text-[11px] leading-[1.5] text-ui-muted/80">{option.description}</p>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="rounded-[10px] border border-on-surface/8 bg-surface p-3.5">
                          <div className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.15em] text-ui-muted">分类粒度</div>
                          <div className="grid gap-1.5">
                            {DENSITY_OPTIONS.map((option) => {
                              const active = strategy.density === option.id;
                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => onChangeDensity(option.id)}
                                  disabled={loading}
                                  className={cn(
                                    "rounded-[8px] border px-3 py-2 text-left transition-all disabled:opacity-50",
                                    active ? "border-primary/25 bg-primary/10" : "border-on-surface/8 bg-surface-container-lowest hover:border-primary/20 hover:bg-surface-container-low",
                                  )}
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <p className={cn("text-[12.5px] font-bold", active ? "text-primary" : "text-on-surface")}>{option.label}</p>
                                    {active ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> : null}
                                  </div>
                                  <p className="mt-0.5 text-[11px] leading-[1.5] text-ui-muted/80">{option.description}</p>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        <div className="rounded-[10px] border border-on-surface/8 bg-surface p-3.5">
                          <div className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.15em] text-ui-muted">目录前缀</div>
                          <div className="grid gap-1.5">
                            {PREFIX_STYLE_OPTIONS.map((option) => {
                              const active = strategy.prefix_style === option.id;
                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => onChangePrefixStyle(option.id)}
                                  disabled={loading}
                                  className={cn(
                                    "rounded-[8px] border px-3 py-2 text-left transition-all disabled:opacity-50",
                                    active ? "border-primary/25 bg-primary/10" : "border-on-surface/8 bg-surface-container-lowest hover:border-primary/20 hover:bg-surface-container-low",
                                  )}
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <p className={cn("text-[12.5px] font-bold", active ? "text-primary" : "text-on-surface")}>{option.label}</p>
                                    {active ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> : null}
                                  </div>
                                  <p className="mt-0.5 text-[11px] leading-[1.5] text-ui-muted/80">{option.description}</p>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </>
                    ) : null}

                    <div className="rounded-[10px] border border-on-surface/8 bg-surface p-3.5">
                      <div className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.15em] text-ui-muted">
                        {isIncremental ? "归档倾向" : "整理方式"}
                      </div>
                      <div className="grid gap-1.5">
                        {CAUTION_LEVEL_OPTIONS.map((option) => {
                          const active = strategy.caution_level === option.id;
                          return (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => onChangeCaution(option.id)}
                              disabled={loading}
                              className={cn(
                                "rounded-[8px] border px-3 py-2 text-left transition-all disabled:opacity-50",
                                active ? "border-primary/25 bg-primary/10" : "border-on-surface/8 bg-surface-container-lowest hover:border-primary/20 hover:bg-surface-container-low",
                              )}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <p className={cn("text-[12.5px] font-bold", active ? "text-primary" : "text-on-surface")}>{option.label}</p>
                                {active ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> : null}
                              </div>
                              <p className="mt-0.5 text-[11px] leading-[1.5] text-ui-muted/80">{option.description}</p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[10px] border border-on-surface/8 bg-surface p-3.5">
                    <div className="mb-2.5 flex items-center justify-between">
                      <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-ui-muted">补充说明</div>
                      <span className="rounded-full border border-on-surface/8 bg-surface-container-lowest px-2 py-0.5 text-[10px] font-semibold text-ui-muted/50">可选</span>
                    </div>
                    <textarea
                      value={strategy.note}
                      disabled={loading}
                      onChange={(event) => onChangeNote(event.target.value.slice(0, 200))}
                      placeholder="例如：项目文件尽量放在一起；拿不准的先放待确认区。"
                      className="min-h-[70px] w-full resize-none rounded-[10px] border border-on-surface/8 bg-surface-container-low px-4 py-3 text-[13px] leading-relaxed text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary/30"
                    />
                    <div className="mt-3 flex items-start gap-3 rounded-[8px] border border-primary/10 bg-primary/4 p-2.5">
                      <div className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-[6px] bg-primary/10 text-primary border border-primary/20">
                        <Sparkles className="h-3.5 w-3.5" />
                      </div>
                      <p className="text-[11px] leading-tight text-primary/80">
                        只补充会影响结果的偏好，例如“拿不准的先放待确认区”“课程资料按学期整理”。
                      </p>
                    </div>
                  </div>
                </section>
              </div>
            </div>

            <div className="shrink-0 border-t border-on-surface/8 bg-surface px-5 py-3 lg:px-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-1.5 opacity-80">
                  {!isIncremental ? (
                    <>
                      <span className="rounded-full border border-primary/12 bg-primary/8 px-2.5 py-0.5 text-[11px] font-bold text-primary">{currentTemplate.label}</span>
                      <span className="rounded-full border border-on-surface/8 bg-surface-container-lowest px-2.5 py-0.5 text-[11px] font-medium text-on-surface-variant">{summary.language_label}</span>
                      <span className="rounded-full border border-on-surface/8 bg-surface-container-lowest px-2.5 py-0.5 text-[11px] font-medium text-on-surface-variant">{summary.density_label}</span>
                      <span className="rounded-full border border-on-surface/8 bg-surface-container-lowest px-2.5 py-0.5 text-[11px] font-medium text-on-surface-variant">{summary.prefix_style_label}</span>
                      <span className="rounded-full border border-on-surface/8 bg-surface-container-lowest px-2.5 py-0.5 text-[11px] font-medium text-on-surface-variant">{summary.caution_level_label}</span>
                    </>
                  ) : (
                    <>
                      <span className="rounded-full border border-primary/12 bg-primary/8 px-2.5 py-0.5 text-[11px] font-bold text-primary">{summary.organize_mode_label}</span>
                      <span className="rounded-full border border-on-surface/8 bg-surface-container-lowest px-2.5 py-0.5 text-[11px] font-medium text-on-surface-variant">显式目标目录</span>
                      <span className="rounded-full border border-on-surface/8 bg-surface-container-lowest px-2.5 py-0.5 text-[11px] font-medium text-on-surface-variant">{summary.caution_level_label}</span>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2.5">
                  <Button variant="secondary" onClick={onClose} className="h-9 px-5 text-[13px] rounded-[8px]">取消</Button>
                  <Button variant="primary" onClick={onConfirm} disabled={loading} className="h-9 px-6 text-[13px] rounded-[8px]">确认并开始</Button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
