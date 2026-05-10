import strategyCatalog from "./strategy-catalog.json";

import type {
  LaunchStrategyConfig,
  OrganizeMethod,
  SessionStrategySelection,
  SessionStrategySummary,
  StrategyCautionLevel,
  StrategyDensity,
  StrategyLanguage,
  StrategyPrefixStyle,
  TaskType,
  StrategyTemplateId,
} from "@/types/session";

type DirectoryCatalogEntry = {
  id: string;
  labels: Record<StrategyLanguage, string>;
  categoryLabels: Record<StrategyLanguage, string>;
};

export interface StrategyTemplateMeta {
  id: StrategyTemplateId;
  label: string;
  description: string;
  applicableScenarios: string;
  directorySets: Record<StrategyDensity, DirectoryCatalogEntry[]>;
  defaultLanguage?: StrategyLanguage;
  defaultDensity?: StrategyDensity;
  defaultPrefixStyle?: StrategyPrefixStyle;
  defaultCautionLevel?: StrategyCautionLevel;
}

export interface StrategyOptionMeta<T extends string> {
  id: T;
  label: string;
  description: string;
}

type StrategyCatalog = {
  defaults: {
    templateId: StrategyTemplateId;
    language: StrategyLanguage;
    density: StrategyDensity;
    prefixStyle: StrategyPrefixStyle;
    cautionLevel: StrategyCautionLevel;
  };
  strategyTemplates: StrategyTemplateMeta[];
  languages: Array<StrategyOptionMeta<StrategyLanguage>>;
  densities: Array<StrategyOptionMeta<StrategyDensity>>;
  prefixStyles: Array<StrategyOptionMeta<StrategyPrefixStyle>>;
  cautionLevels: Array<StrategyOptionMeta<StrategyCautionLevel>>;
};

const catalog = strategyCatalog as StrategyCatalog;

export const STRATEGY_TEMPLATES: StrategyTemplateMeta[] = catalog.strategyTemplates;
export const LANGUAGE_OPTIONS: StrategyOptionMeta<StrategyLanguage>[] = catalog.languages;
export const DENSITY_OPTIONS: StrategyOptionMeta<StrategyDensity>[] = catalog.densities;
export const PREFIX_STYLE_OPTIONS: StrategyOptionMeta<StrategyPrefixStyle>[] = catalog.prefixStyles;
export const CAUTION_LEVEL_OPTIONS: StrategyOptionMeta<StrategyCautionLevel>[] = catalog.cautionLevels;

export function taskTypeForOrganizeMode(organizeMode: SessionStrategySelection["organize_mode"] | null | undefined): TaskType {
  return organizeMode === "incremental" ? "organize_into_existing" : "organize_full_directory";
}

export function organizeMethodForOrganizeMode(
  organizeMode: SessionStrategySelection["organize_mode"] | null | undefined,
): OrganizeMethod {
  return organizeMode === "incremental"
    ? "assign_into_existing_categories"
    : "categorize_into_new_structure";
}

export function taskTypeLabel(taskType: TaskType): string {
  return taskType === "organize_into_existing" ? "归入已有目录" : "整理整个目录";
}

export const DEFAULT_STRATEGY_SELECTION: SessionStrategySelection = {
  template_id: catalog.defaults.templateId,
  organize_mode: "initial",
  task_type: "organize_full_directory",
  organize_method: "categorize_into_new_structure",
  destination_index_depth: 2,
  language: catalog.defaults.language,
  density: catalog.defaults.density,
  prefix_style: catalog.defaults.prefixStyle,
  caution_level: catalog.defaults.cautionLevel,
  note: "",
};

export function getTemplateMeta(templateId: StrategyTemplateId): StrategyTemplateMeta {
  return STRATEGY_TEMPLATES.find((template) => template.id === templateId) || STRATEGY_TEMPLATES[0];
}

function buildDirectoryName(
  entry: DirectoryCatalogEntry,
  index: number,
  language: StrategyLanguage,
  prefixStyle: StrategyPrefixStyle,
): string {
  const baseLabel = entry.labels[language] || entry.labels.zh;
  if (!baseLabel) {
    return "";
  }
  if (prefixStyle === "numeric") {
    return `${String(index + 1).padStart(2, "0")}_${baseLabel}`;
  }
  if (prefixStyle === "category") {
    const categoryLabel = entry.categoryLabels[language] || entry.categoryLabels.zh || baseLabel;
    return `[${categoryLabel}] ${baseLabel}`;
  }
  return baseLabel;
}

export function buildPreviewDirectories(strategy: Pick<SessionStrategySelection, "template_id" | "language" | "density" | "prefix_style">): string[] {
  const template = getTemplateMeta(strategy.template_id);
  const entries = template.directorySets[strategy.density] || template.directorySets.normal || [];
  return entries
    .map((entry, index) => buildDirectoryName(entry, index, strategy.language, strategy.prefix_style))
    .filter(Boolean);
}

export function getSuggestedSelection(
  templateId: StrategyTemplateId,
): Pick<SessionStrategySelection, "language" | "density" | "prefix_style" | "caution_level"> {
  const template = getTemplateMeta(templateId);
  return {
    language: template.defaultLanguage || DEFAULT_STRATEGY_SELECTION.language,
    density: template.defaultDensity || DEFAULT_STRATEGY_SELECTION.density,
    prefix_style: template.defaultPrefixStyle || DEFAULT_STRATEGY_SELECTION.prefix_style,
    caution_level: template.defaultCautionLevel || DEFAULT_STRATEGY_SELECTION.caution_level,
  };
}

function isValidTemplateId(value: unknown): value is StrategyTemplateId {
  return STRATEGY_TEMPLATES.some((template) => template.id === value);
}

function isValidLanguage(value: unknown): value is StrategyLanguage {
  return LANGUAGE_OPTIONS.some((option) => option.id === value);
}

function isValidDensity(value: unknown): value is StrategyDensity {
  return DENSITY_OPTIONS.some((option) => option.id === value);
}

function isValidPrefixStyle(value: unknown): value is StrategyPrefixStyle {
  return PREFIX_STYLE_OPTIONS.some((option) => option.id === value);
}

function isValidCautionLevel(value: unknown): value is StrategyCautionLevel {
  return CAUTION_LEVEL_OPTIONS.some((option) => option.id === value);
}

function isValidOrganizeMethod(value: unknown): value is OrganizeMethod {
  return value === "categorize_into_new_structure" || value === "assign_into_existing_categories";
}

export function getLaunchStrategyFromConfig(config?: LaunchStrategyConfig | null): SessionStrategySelection {
  const templateId = isValidTemplateId(config?.LAUNCH_DEFAULT_TEMPLATE_ID)
    ? config.LAUNCH_DEFAULT_TEMPLATE_ID
    : DEFAULT_STRATEGY_SELECTION.template_id;
  const suggested = getSuggestedSelection(templateId);
  const organizeMethod = isValidOrganizeMethod(config?.LAUNCH_DEFAULT_ORGANIZE_METHOD)
    ? config.LAUNCH_DEFAULT_ORGANIZE_METHOD
    : DEFAULT_STRATEGY_SELECTION.organize_method;
  const organizeMode = organizeMethod === "assign_into_existing_categories" ? "incremental" : "initial";

  return {
    template_id: templateId,
    organize_mode: organizeMode,
    task_type: taskTypeForOrganizeMode(organizeMode),
    organize_method: organizeMethod,
    destination_index_depth: 2,
    language: isValidLanguage(config?.LAUNCH_DEFAULT_LANGUAGE)
      ? config.LAUNCH_DEFAULT_LANGUAGE
      : suggested.language,
    density: isValidDensity(config?.LAUNCH_DEFAULT_DENSITY)
      ? config.LAUNCH_DEFAULT_DENSITY
      : suggested.density,
    prefix_style: isValidPrefixStyle(config?.LAUNCH_DEFAULT_PREFIX_STYLE)
      ? config.LAUNCH_DEFAULT_PREFIX_STYLE
      : suggested.prefix_style,
    caution_level: isValidCautionLevel(config?.LAUNCH_DEFAULT_CAUTION_LEVEL)
      ? config.LAUNCH_DEFAULT_CAUTION_LEVEL
      : suggested.caution_level,
    target_profile_id: typeof config?.LAUNCH_DEFAULT_TARGET_PROFILE_ID === "string"
      ? config.LAUNCH_DEFAULT_TARGET_PROFILE_ID
      : undefined,
    note: typeof config?.LAUNCH_DEFAULT_NOTE === "string" ? config.LAUNCH_DEFAULT_NOTE : "",
  };
}

export function shouldSkipLaunchStrategyPrompt(config?: LaunchStrategyConfig | null): boolean {
  return Boolean(config?.LAUNCH_SKIP_STRATEGY_PROMPT);
}

export function buildStrategySummary(strategy: SessionStrategySelection): SessionStrategySummary {
  const template = getTemplateMeta(strategy.template_id);
  const taskType = strategy.task_type || taskTypeForOrganizeMode(strategy.organize_mode);
  const organizeMethod = strategy.organize_method || organizeMethodForOrganizeMode(strategy.organize_mode);
  const languageLabel = LANGUAGE_OPTIONS.find((item) => item.id === strategy.language)?.label || "中文目录";
  const densityLabel = DENSITY_OPTIONS.find((item) => item.id === strategy.density)?.label || "常规分类";
  const prefixStyleLabel = PREFIX_STYLE_OPTIONS.find((item) => item.id === strategy.prefix_style)?.label || "无前缀";
  const cautionLabel = CAUTION_LEVEL_OPTIONS.find((item) => item.id === strategy.caution_level)?.label || "平衡";

  return {
    ...strategy,
    task_type: taskType,
    organize_method: organizeMethod,
    task_type_label: taskTypeLabel(taskType),
    template_label: template.label,
    template_description: template.description,
    organize_mode_label: taskTypeLabel(taskType),
    language_label: languageLabel,
    density_label: densityLabel,
    prefix_style_label: prefixStyleLabel,
    caution_level_label: cautionLabel,
    preview_directories: buildPreviewDirectories(strategy),
  };
}
