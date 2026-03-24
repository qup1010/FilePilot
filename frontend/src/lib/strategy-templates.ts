import type {
  SessionStrategySelection,
  StrategyCautionLevel,
  StrategyNamingStyle,
  StrategyTemplateId,
} from "@/types/session";

export interface StrategyTemplateMeta {
  id: StrategyTemplateId;
  label: string;
  description: string;
  applicableScenarios: string;
  previewDirectories: Record<StrategyNamingStyle, string[]>;
  defaultNamingStyle?: StrategyNamingStyle;
  defaultCautionLevel?: StrategyCautionLevel;
}

export interface StrategyOptionMeta<T extends string> {
  id: T;
  label: string;
  description: string;
}

export const STRATEGY_TEMPLATES: StrategyTemplateMeta[] = [
  {
    id: "general_downloads",
    label: "通用下载",
    description: "适合下载目录、桌面暂存区等混合文件场景。",
    applicableScenarios: "下载文件夹、桌面离散文件、回收站前的暂存区",
    previewDirectories: {
      zh: ["项目资料", "财务票据", "学习资料", "安装程序", "待确认"],
      en: ["Projects", "Finance", "Study", "Installers", "Review"],
      minimal: ["Docs", "Media", "Installers", "Archives", "Review"],
    },
    defaultNamingStyle: "zh",
    defaultCautionLevel: "balanced",
  },
  {
    id: "project_workspace",
    label: "项目资料",
    description: "适合项目文档、代码、素材、交付物混合的工作目录。",
    applicableScenarios: "工作项目根目录、GitHub 仓库、客户交付件汇总",
    previewDirectories: {
      zh: ["项目资料", "项目文档", "交付物", "素材资源", "待确认"],
      en: ["Projects", "Docs", "Deliverables", "Assets", "Review"],
      minimal: ["Projects", "Docs", "Assets", "Archives", "Review"],
    },
    defaultNamingStyle: "en",
    defaultCautionLevel: "balanced",
  },
  {
    id: "study_materials",
    label: "学习资料",
    description: "适合课程讲义、笔记、作业、参考资料与学习截图。",
    applicableScenarios: "网课下载目录、考研/考证资料、学生作业文件夹",
    previewDirectories: {
      zh: ["课程资料", "笔记讲义", "作业练习", "参考资料", "待确认"],
      en: ["Courses", "Notes", "Assignments", "Reference", "Review"],
      minimal: ["Study", "Notes", "Reference", "Archives", "Review"],
    },
    defaultNamingStyle: "zh",
    defaultCautionLevel: "balanced",
  },
  {
    id: "office_admin",
    label: "办公事务",
    description: "适合合同、报销、发票、表格、报告等正式办公资料。",
    applicableScenarios: "行政办公室、财务报销单据、企业合同管理",
    previewDirectories: {
      zh: ["财务票据", "合同协议", "报告报表", "流程表单", "待确认"],
      en: ["Finance", "Contracts", "Reports", "Forms", "Review"],
      minimal: ["Docs", "Finance", "Archives", "Review"],
    },
    defaultNamingStyle: "en",
    defaultCautionLevel: "balanced",
  },
  {
    id: "conservative",
    label: "保守整理",
    description: "适合第一次使用或希望最小改动的安全模式。",
    applicableScenarios: "非结构化老旧数据、敏感工作目录、尝试性整理",
    previewDirectories: {
      zh: ["文档资料", "媒体素材", "安装程序", "历史归档", "待确认"],
      en: ["Docs", "Media", "Installers", "Archives", "Review"],
      minimal: ["Docs", "Media", "Archives", "Review"],
    },
    defaultNamingStyle: "zh",
    defaultCautionLevel: "conservative",
  },
];

export const NAMING_STYLE_OPTIONS: StrategyOptionMeta<StrategyNamingStyle>[] = [
  { id: "zh", label: "中文目录", description: "目录名更自然，适合个人资料和学习资料场景。" },
  { id: "en", label: "英文目录", description: "目录名更规范，适合项目协作和办公场景。" },
  { id: "minimal", label: "极简目录", description: "目录更少更宽泛，减少层级和分类粒度。" },
];

export const CAUTION_LEVEL_OPTIONS: StrategyOptionMeta<StrategyCautionLevel>[] = [
  { id: "conservative", label: "保守", description: "只自动处理高置信度文件，模糊项优先进 Review。" },
  { id: "balanced", label: "平衡", description: "常规项自动归类，明显不确定的文件再保留待确认。" },
];

export const DEFAULT_STRATEGY_SELECTION: SessionStrategySelection = {
  template_id: "general_downloads",
  naming_style: "zh",
  caution_level: "balanced",
  note: "",
};

export function getTemplateMeta(templateId: StrategyTemplateId): StrategyTemplateMeta {
  return STRATEGY_TEMPLATES.find((template) => template.id === templateId) || STRATEGY_TEMPLATES[0];
}

export function getSuggestedSelection(templateId: StrategyTemplateId): Pick<SessionStrategySelection, "naming_style" | "caution_level"> {
  const template = getTemplateMeta(templateId);
  return {
    naming_style: template.defaultNamingStyle || DEFAULT_STRATEGY_SELECTION.naming_style,
    caution_level: template.defaultCautionLevel || DEFAULT_STRATEGY_SELECTION.caution_level,
  };
}
