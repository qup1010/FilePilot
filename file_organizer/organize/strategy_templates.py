from __future__ import annotations

from copy import deepcopy

DEFAULT_TEMPLATE_ID = "general_downloads"
DEFAULT_NAMING_STYLE = "zh"
DEFAULT_CAUTION_LEVEL = "balanced"

STRATEGY_TEMPLATES = {
    "general_downloads": {
        "id": "general_downloads",
        "label": "通用下载",
        "description": "适合下载目录、桌面暂存区等混合文件场景。",
        "default_naming_style": DEFAULT_NAMING_STYLE,
        "default_caution_level": DEFAULT_CAUTION_LEVEL,
        "preview_directories": {
            "zh": ["项目资料", "财务票据", "学习资料", "安装程序", "待确认"],
            "en": ["Projects", "Finance", "Study", "Installers", "Review"],
            "minimal": ["Docs", "Media", "Installers", "Archives", "Review"],
        },
        "prompt_fragment": "\n".join(
            [
                "场景重点：这是一个混合下载目录或零散收纳目录。",
                "优先目标：快速把杂乱文件按实际用途归到清晰的大类，而不是过度细分。",
                "优先考虑的目录语义：项目资料、财务票据、学习资料、安装程序、截图记录、媒体素材、历史归档、待确认。",
            ]
        ),
    },
    "project_workspace": {
        "id": "project_workspace",
        "label": "项目资料",
        "description": "适合项目工作目录、交付目录、设计与代码并存的场景。",
        "default_naming_style": "en",
        "default_caution_level": DEFAULT_CAUTION_LEVEL,
        "preview_directories": {
            "zh": ["项目资料", "项目文档", "交付物", "素材资源", "待确认"],
            "en": ["Projects", "Docs", "Deliverables", "Assets", "Review"],
            "minimal": ["Projects", "Docs", "Assets", "Archives", "Review"],
        },
        "prompt_fragment": "\n".join(
            [
                "场景重点：这是一个项目工作目录，可能同时包含代码、文档、设计稿、导出物和素材。",
                "优先目标：尽量按项目语义和交付流程整理，不要把同一项目相关文件按扩展名拆散。",
                "优先考虑的目录语义：Projects、Docs、Deliverables、Assets、Archives、Review。",
            ]
        ),
    },
    "study_materials": {
        "id": "study_materials",
        "label": "学习资料",
        "description": "适合课程讲义、笔记、作业、截图和参考材料。",
        "default_naming_style": DEFAULT_NAMING_STYLE,
        "default_caution_level": DEFAULT_CAUTION_LEVEL,
        "preview_directories": {
            "zh": ["课程资料", "笔记讲义", "作业练习", "参考资料", "待确认"],
            "en": ["Courses", "Notes", "Assignments", "Reference", "Review"],
            "minimal": ["Study", "Notes", "Reference", "Archives", "Review"],
        },
        "prompt_fragment": "\n".join(
            [
                "场景重点：这是一个学习资料目录，通常包含课件、讲义、笔记、作业、截图和参考材料。",
                "优先目标：按学习用途整理，让课程资料、笔记、作业和参考材料彼此分离。",
                "优先考虑的目录语义：课程资料、笔记讲义、作业练习、参考资料、学习截图、待确认。",
            ]
        ),
    },
    "office_admin": {
        "id": "office_admin",
        "label": "办公事务",
        "description": "适合合同、报表、发票、通知、表格等正式办公资料。",
        "default_naming_style": "en",
        "default_caution_level": DEFAULT_CAUTION_LEVEL,
        "preview_directories": {
            "zh": ["财务票据", "合同协议", "报告报表", "流程表单", "待确认"],
            "en": ["Finance", "Contracts", "Reports", "Forms", "Review"],
            "minimal": ["Docs", "Finance", "Archives", "Review"],
        },
        "prompt_fragment": "\n".join(
            [
                "场景重点：这是一个办公事务目录，常见内容包括合同、发票、通知、报表、流程文档和表格。",
                "优先目标：优先保证财务、合同和正式文档的可检索性与稳定性。",
                "优先考虑的目录语义：Finance、Contracts、Reports、Forms、Archives、Review。",
                "遇到票据、合同、付款或报销相关内容时，优先按财务/合同语义归类。",
            ]
        ),
    },
    "conservative": {
        "id": "conservative",
        "label": "保守整理",
        "description": "适合第一次使用、希望最小改动和更强安全感的场景。",
        "default_naming_style": DEFAULT_NAMING_STYLE,
        "default_caution_level": "conservative",
        "preview_directories": {
            "zh": ["文档资料", "媒体素材", "安装程序", "历史归档", "待确认"],
            "en": ["Docs", "Media", "Installers", "Archives", "Review"],
            "minimal": ["Docs", "Media", "Archives", "Review"],
        },
        "prompt_fragment": "\n".join(
            [
                "场景重点：这是一个强调安全感和最小改动的整理任务。",
                "优先目标：尽量少建目录、少做激进推断，只移动高置信度项目。",
                "如果不能稳定判断，就优先放入 Review，而不是勉强归类。",
            ]
        ),
    },
}

NAMING_STYLES = {
    "zh": {
        "id": "zh",
        "label": "中文目录",
        "prompt_fragment": "\n".join(
            [
                "目录命名风格：优先使用简洁、自然、统一的中文目录名。",
                "避免中英混搭；同一套方案中的目录语言保持一致。",
            ]
        ),
    },
    "en": {
        "id": "en",
        "label": "英文目录",
        "prompt_fragment": "\n".join(
            [
                "目录命名风格：优先使用清晰稳定的英文目录名，适合项目和办公协作场景。",
                "尽量采用常见英文分类词，不要同时混用中文同义目录。",
            ]
        ),
    },
    "minimal": {
        "id": "minimal",
        "label": "极简目录",
        "prompt_fragment": "\n".join(
            [
                "目录命名风格：优先使用更少、更宽泛的目录层级。",
                "目标是减少目录数量和分类粒度，避免为了整齐而创建过多目录。",
            ]
        ),
    },
}

CAUTION_LEVELS = {
    "conservative": {
        "id": "conservative",
        "label": "保守",
        "prompt_fragment": "\n".join(
            [
                "整理保守度：保守。",
                "只有在用途较明确时才自动归类；模糊项优先进入 Review。",
                "尽量减少新目录数量，优先保证可解释性和可回退性。",
            ]
        ),
    },
    "balanced": {
        "id": "balanced",
        "label": "平衡",
        "prompt_fragment": "\n".join(
            [
                "整理保守度：平衡。",
                "对高置信度和中高置信度项目都可以直接归类，只把真正拿不准的项放入 Review。",
                "允许为清晰结构创建适量目录，但不要过度细分。",
            ]
        ),
    },
}


def list_strategy_templates() -> list[dict]:
    return [deepcopy(template) for template in STRATEGY_TEMPLATES.values()]


def normalize_strategy_selection(raw: dict | None = None) -> dict:
    payload = raw or {}
    template_id = payload.get("template_id")
    if template_id not in STRATEGY_TEMPLATES:
        template_id = DEFAULT_TEMPLATE_ID

    template = STRATEGY_TEMPLATES[template_id]

    naming_style = payload.get("naming_style") or template.get("default_naming_style") or DEFAULT_NAMING_STYLE
    if naming_style not in NAMING_STYLES:
        naming_style = template.get("default_naming_style") or DEFAULT_NAMING_STYLE

    caution_level = payload.get("caution_level") or template.get("default_caution_level") or DEFAULT_CAUTION_LEVEL
    if caution_level not in CAUTION_LEVELS:
        caution_level = template.get("default_caution_level") or DEFAULT_CAUTION_LEVEL

    note = str(payload.get("note") or "").strip()
    preview_directories = list(template.get("preview_directories", {}).get(naming_style, []))

    return {
        "template_id": template_id,
        "template_label": template["label"],
        "template_description": template["description"],
        "naming_style": naming_style,
        "naming_style_label": NAMING_STYLES[naming_style]["label"],
        "caution_level": caution_level,
        "caution_level_label": CAUTION_LEVELS[caution_level]["label"],
        "note": note,
        "preview_directories": preview_directories,
    }


def build_strategy_prompt_fragment(selection: dict | None = None) -> str:
    normalized = normalize_strategy_selection(selection)
    template = STRATEGY_TEMPLATES[normalized["template_id"]]
    naming = NAMING_STYLES[normalized["naming_style"]]
    caution = CAUTION_LEVELS[normalized["caution_level"]]

    lines = [
        "当前固定整理策略（必须优先遵守）：",
        f"- 主模板：{normalized['template_label']}。{template['description']}",
        template["prompt_fragment"],
        naming["prompt_fragment"],
        caution["prompt_fragment"],
    ]
    if normalized["note"]:
        lines.append(f"用户补充说明：{normalized['note']}")
    return "\n".join(lines)

