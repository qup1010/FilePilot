import { SessionStrategySummary } from "@/types/session";

export function StrategySummaryChips({ strategy }: { strategy: SessionStrategySummary }) {
  const isIncremental = strategy.organize_mode === "incremental";
  return (
    <div className="flex flex-wrap gap-2">
      <span className="ui-pill border-primary/12 bg-primary/8 text-primary">{strategy.task_type_label}</span>
      {!isIncremental ? <span className="ui-pill">{strategy.template_label}</span> : null}
      {isIncremental ? <span className="ui-pill">显式目标目录</span> : null}
      {!isIncremental ? <span className="ui-pill">{strategy.language_label}</span> : null}
      {!isIncremental ? <span className="ui-pill">{strategy.density_label}</span> : null}
      {!isIncremental ? <span className="ui-pill">{strategy.prefix_style_label}</span> : null}
      <span className="ui-pill">{strategy.caution_level_label}</span>
      {strategy.note ? (
        <span className="ui-pill border-warning/12 bg-warning-container/30">
          偏好：{strategy.note}
        </span>
      ) : null}
    </div>
  );
}
