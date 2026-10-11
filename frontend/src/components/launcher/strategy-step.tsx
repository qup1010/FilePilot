import { Activity, FileText, FolderOpen, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  CAUTION_LEVEL_OPTIONS,
  getSuggestedSelection,
  PREFIX_STYLE_OPTIONS,
  STRATEGY_TEMPLATES,
} from "@/lib/strategy-templates";
import { FOLDER_NAME_LANGUAGE_OPTIONS, resolveFolderNameLanguage } from "@/lib/folder-name-language";
import { cn } from "@/lib/utils";
import type {
  LauncherStrategySelection,
  StrategyPrefixStyle,
  StrategyTemplateId,
} from "@/types/session";

interface StrategyStepProps {
  strategy: LauncherStrategySelection;
  loading: boolean;
  isFullCategorize: boolean;
  newDirectoryRoot: string;
  previewDirectories: string[] | undefined;
  onUpdateStrategy: (updater: (previous: LauncherStrategySelection) => LauncherStrategySelection) => void;
  onOpenAdvancedSettings: () => void;
}

export function StrategyStep({
  strategy,
  loading,
  isFullCategorize,
  newDirectoryRoot,
  previewDirectories,
  onUpdateStrategy,
  onOpenAdvancedSettings,
}: StrategyStepProps) {
  const { t, i18n } = useTranslation("common");
  const languagePreference = strategy.language_preference ?? strategy.language;
  const resolvedFolderNameLanguage = resolveFolderNameLanguage(
    languagePreference,
    i18n.resolvedLanguage || i18n.language,
  );
  const templateDescription = t(`strategy.templates.${strategy.template_id}.description`, {
    defaultValue: "",
  });
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {isFullCategorize ? (
        <>
          {/* 分类控制参数 */}
          <div className="rounded-[8px] bg-surface-container-lowest p-4 flex flex-col justify-between min-h-[160px] border border-on-surface/5">
            <div className="space-y-3.5">
              <div className="flex items-center justify-between">
                <h2 className="text-[13px] font-bold text-on-surface flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  {t("strategy.controlsTitle")}
                </h2>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* 分类模板 */}
                <div className="space-y-1">
                  <div className="text-[11px] font-bold text-on-surface/60">{t("strategy.template")}</div>
                  <select
                    value={strategy.template_id}
                    onChange={(event) => {
                      const tid = event.target.value as StrategyTemplateId;
                      const suggested = getSuggestedSelection(tid);
                      onUpdateStrategy((previous) => ({
                        ...previous,
                        template_id: tid,
                        density: suggested.density,
                        prefix_style: suggested.prefix_style,
                        caution_level: suggested.caution_level,
                      }));
                    }}
                    disabled={loading}
                    className="h-8.5 w-full rounded-[6px] border border-on-surface/8 bg-surface px-2 text-[12px] font-medium text-on-surface outline-none transition-all focus:border-primary/45 focus:ring-2 focus:ring-primary/5"
                  >
                    {STRATEGY_TEMPLATES.map((template) => (
                      <option key={template.id} value={template.id}>
                        {t(`strategy.templates.${template.id}.label`, { defaultValue: template.label })}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 目录语言 */}
                <div className="space-y-1">
                  <div className="text-[11px] font-bold text-on-surface/60">{t("strategy.outputLanguage")}</div>
                  <select
                    aria-label={t("strategy.outputLanguage")}
                    value={languagePreference}
                    onChange={(event) => {
                      const preference = event.target.value as LauncherStrategySelection["language_preference"];
                      onUpdateStrategy((prev) => ({
                        ...prev,
                        language_preference: preference,
                        language: resolveFolderNameLanguage(preference, i18n.resolvedLanguage || i18n.language),
                      }));
                    }}
                    disabled={loading}
                    className="h-8.5 w-full rounded-[6px] border border-on-surface/8 bg-surface px-2 text-[12px] font-medium text-on-surface outline-none transition-all focus:border-primary/45 focus:ring-2 focus:ring-primary/5"
                  >
                    {FOLDER_NAME_LANGUAGE_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {t(`strategy.languageOptions.${option.id}`, { defaultValue: option.label })}
                      </option>
                    ))}
                  </select>
                  {languagePreference === "auto" ? (
                    <p className="text-[10px] leading-4 text-on-surface/55">
                      {t("strategy.languageOptions.autoResolved", {
                        language: t(`strategy.languageOptions.${resolvedFolderNameLanguage}`),
                      })}
                    </p>
                  ) : null}
                </div>
              </div>

              {/* 前缀样式 */}
              <div className="space-y-1">
                <div className="text-[11px] font-bold text-on-surface/60">{t("strategy.prefixStyle")}</div>
                <select
                  value={strategy.prefix_style}
                  onChange={(event) => onUpdateStrategy((prev) => ({ ...prev, prefix_style: event.target.value as StrategyPrefixStyle }))}
                  className="h-8.5 w-full rounded-[6px] border border-on-surface/8 bg-surface px-2.5 text-[12px] font-medium text-on-surface outline-none transition-all focus:border-primary/45 focus:ring-2 focus:ring-primary/5"
                >
                  {PREFIX_STYLE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {t(`strategy.prefixOptions.${option.id}`, { defaultValue: option.label })}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-3.5 flex justify-between items-center border-t border-on-surface/5 pt-2">
              <span className="text-[11px] text-on-surface/40 font-medium">{t("strategy.advancedPrompt")}</span>
              <button
                type="button"
                onClick={onOpenAdvancedSettings}
                className="text-[11px] font-bold text-primary hover:underline underline-offset-2"
              >
                {t("strategy.advancedSettings")}
              </button>
            </div>
          </div>

          {/* 分类样式示例 */}
          <div className="rounded-[8px] bg-surface-container-lowest p-4 flex flex-col justify-between min-h-[220px] border border-on-surface/5">
            <div className="space-y-3">
              <div className="text-[13px] font-black text-on-surface">{t("strategy.previewTitle")}</div>

              {/* 极简模拟树状图面板 */}
              <div className="rounded-[6px] border border-on-surface/8 bg-surface p-3 font-mono text-[11px] text-on-surface/80 max-h-[140px] overflow-y-auto scrollbar-thin space-y-2">
                {/* 根目录节点 */}
                <div className="flex items-center gap-1.5 text-on-surface-variant/70 font-semibold truncate border-b border-on-surface/5 pb-2">
                  <FolderOpen className="h-3.5 w-3.5 text-primary/60 shrink-0" />
                  <span className="truncate" title={newDirectoryRoot || "D:/Desktop/毕业/毕业答辩PPT"}>
                    {newDirectoryRoot || "D:/Desktop/毕业/毕业答辩PPT"}
                  </span>
                </div>

                {/* 子树节点 */}
                <div className="pl-1.5 space-y-2 pt-0.5">
                  {previewDirectories?.map((directory, idx, arr) => {
                    const isLastDir = idx === arr.length - 1;

                    // 智能模拟子文件类型
                    const mockFile = t("strategy.previewExampleFile");

                    return (
                      <div key={directory} className="space-y-1">
                        {/* 文件夹行 */}
                        <div className="flex items-center gap-1.5">
                          <span className="text-on-surface/20 font-bold font-sans shrink-0">{isLastDir ? "└─" : "├─"}</span>
                          <span className="inline-flex items-center gap-1 rounded-[4px] border border-primary/10 bg-primary/[0.04] px-2 py-0.5 text-[11px] font-bold text-primary max-w-[85%] truncate">
                            <FolderOpen className="h-3 w-3 shrink-0 text-primary/60" />
                            <span className="truncate">{directory}</span>
                          </span>
                        </div>

                        {/* 模拟文件行 */}
                        <div className="flex items-center gap-1.5 text-[11px] text-ui-muted opacity-55" style={{ paddingLeft: "24px" }}>
                          <span className="text-on-surface/20 font-bold font-sans shrink-0">{isLastDir ? "    └─" : "│   └─"}</span>
                          <FileText className="h-3 w-3 shrink-0" />
                          <span className="truncate">{mockFile}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <p className="mt-2 text-[11px] font-medium leading-relaxed text-ui-muted truncate" title={templateDescription}>
              {templateDescription}
            </p>
          </div>
        </>
      ) : (
        <>
          {/* 归归档倾向配置 */}
          <div className="rounded-[8px] bg-surface-container-lowest p-4 flex flex-col justify-between min-h-[160px] border border-on-surface/5">
            <div className="space-y-3.5">
              <h2 className="text-[13px] font-black text-on-surface flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-primary" />
                {t("strategy.archiveTitle")}
              </h2>

              <div className="space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-ui-muted">{t("strategy.archivePolicy")}</div>
                <div className="grid grid-cols-2 gap-2">
                  {CAUTION_LEVEL_OPTIONS.map((option) => {
                    const active = strategy.caution_level === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => onUpdateStrategy((prev) => ({ ...prev, caution_level: option.id }))}
                        className={cn(
                          "rounded-[6px] border px-2.5 py-1.5 text-left transition-all text-[11px] font-bold",
                          active
                            ? "border-primary/25 bg-primary/10 text-primary"
                            : "border-on-surface/8 bg-surface text-on-surface hover:bg-surface-container-low"
                        )}
                      >
                        <div>{t(`strategy.cautionOptions.${option.id}`, { defaultValue: option.label })}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* 任务补充说明 */}
          <div className="rounded-[8px] bg-surface-container-lowest p-4 flex flex-col justify-between min-h-[160px] border border-on-surface/5">
            <div className="space-y-2 flex-1 flex flex-col">
              <div className="text-[11px] font-black text-on-surface flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-primary" />
                {t("strategy.additionalNotes")}
              </div>
              <textarea
                value={strategy.note}
                disabled={loading}
                onChange={(event) => onUpdateStrategy((previous) => ({ ...previous, note: event.target.value.slice(0, 200) }))}
                placeholder={t("strategy.notesPlaceholder")}
                className="w-full flex-1 min-h-[80px] resize-none rounded-[6px] border border-on-surface/8 bg-surface px-3 py-2 text-[12px] leading-relaxed text-on-surface outline-none transition-all placeholder:text-on-surface-variant/35 focus:border-primary/30"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
