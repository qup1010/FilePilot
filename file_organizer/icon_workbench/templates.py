from __future__ import annotations

from file_organizer.icon_workbench.models import IconTemplate, utc_now_iso


def builtin_templates() -> list[IconTemplate]:
    timestamp = utc_now_iso()
    return [
        IconTemplate(
            template_id="minimal_line",
            name="极简线稿",
            description="干净轮廓与低细节，适合办公与项目目录。",
            prompt_template=(
                "A Windows folder icon of {{subject}}, minimalist line style, "
                "clean geometric silhouette, subtle depth, no text, transparent background"
            ),
            is_builtin=True,
            created_at=timestamp,
            updated_at=timestamp,
        ),
        IconTemplate(
            template_id="paper_cut",
            name="纸艺分层",
            description="层叠纸片质感，强调分类感。",
            prompt_template=(
                "A Windows folder icon featuring {{subject}}, layered paper-cut style, "
                "clear edges, soft shadow depth, no text, transparent background"
            ),
            is_builtin=True,
            created_at=timestamp,
            updated_at=timestamp,
        ),
        IconTemplate(
            template_id="3d_clay",
            name="柔和 3D",
            description="圆润体块与中度材质细节，适合素材类目录。",
            prompt_template=(
                "A Windows folder icon of {{subject}}, soft 3D clay render style, "
                "centered object, polished lighting, no text, transparent background"
            ),
            is_builtin=True,
            created_at=timestamp,
            updated_at=timestamp,
        ),
        IconTemplate(
            template_id="tech_blueprint",
            name="技术蓝图",
            description="线框与工程感细节，适合代码和项目工作区。",
            prompt_template=(
                "A Windows folder icon of {{subject}}, technical blueprint style, "
                "precise linework, structured composition, no text, transparent background"
            ),
            is_builtin=True,
            created_at=timestamp,
            updated_at=timestamp,
        ),
        IconTemplate(
            template_id="retro_pixel",
            name="复古像素",
            description="像素风格，适合游戏与怀旧素材目录。",
            prompt_template=(
                "A Windows folder icon featuring {{subject}}, retro pixel-art style, "
                "high contrast palette, crisp edges, no text, transparent background"
            ),
            is_builtin=True,
            created_at=timestamp,
            updated_at=timestamp,
        ),
    ]


def render_prompt_template(
    prompt_template: str,
    *,
    folder_name: str,
    category: str,
    subject: str,
) -> str:
    normalized_template = (prompt_template or "").strip()
    if not normalized_template:
        normalized_template = (
            "A Windows folder icon featuring {{subject}}, balanced modern style, "
            "no text, transparent background"
        )
    replacements = {
        "{{folder_name}}": folder_name.strip() or "Folder",
        "{{category}}": category.strip() or "General",
        "{{subject}}": subject.strip() or folder_name.strip() or "Folder",
    }
    rendered = normalized_template
    for key, value in replacements.items():
        rendered = rendered.replace(key, value)
    return rendered

