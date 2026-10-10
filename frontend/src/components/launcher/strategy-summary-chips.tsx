import { SessionStrategySummary } from "@/types/session";
import { useTranslation } from "react-i18next";

export function StrategySummaryChips({ strategy }: { strategy: SessionStrategySummary }) {
  const { t } = useTranslation("common");
  const isIncremental = strategy.organize_mode === "incremental";
  return (
    <div className="flex flex-wrap gap-2">
      <span className="ui-pill border-primary/12 bg-primary/8 text-primary">{t(`strategy.taskType.${strategy.task_type}`)}</span>
      {!isIncremental ? <span className="ui-pill">{t(`strategy.templates.${strategy.template_id}.label`, { defaultValue: strategy.template_label })}</span> : null}
      {isIncremental ? <span className="ui-pill">{t("strategy.explicitTarget")}</span> : null}
      {!isIncremental ? <span className="ui-pill">{t(`strategy.languageOptions.${strategy.language}`, { defaultValue: strategy.language_label })}</span> : null}
      {!isIncremental ? <span className="ui-pill">{t(`strategy.densityOptions.${strategy.density}`, { defaultValue: strategy.density_label })}</span> : null}
      {!isIncremental ? <span className="ui-pill">{t(`strategy.prefixOptions.${strategy.prefix_style}`, { defaultValue: strategy.prefix_style_label })}</span> : null}
      <span className="ui-pill">{t(`strategy.cautionOptions.${strategy.caution_level}`, { defaultValue: strategy.caution_level_label })}</span>
      {strategy.note ? (
        <span className="ui-pill border-warning/12 bg-warning-container/30">
          {t("strategy.preferencePrefix")}{strategy.note}
        </span>
      ) : null}
    </div>
  );
}
