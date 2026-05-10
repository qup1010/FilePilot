from __future__ import annotations

from file_pilot.icon_workbench.models import IconTemplate, utc_now_iso


def builtin_templates() -> list[IconTemplate]:
    timestamp = utc_now_iso()
    return [
        IconTemplate(
            template_id="3d_clay",
            name="3D 黏土",
            description="柔和的粉彩颜色与圆润的黏土质感，营造出可爱有趣的视觉氛围。",
            prompt_template=(
                "A Windows folder icon of {{subject}}, cute 3D claymorphism style, "
                "soft pastel colors, rounded edges, plasticine texture, studio lighting, playful vibe, no text, transparent background"
            ),
            cover_image="/template-covers/3d_clay.webp",
            is_builtin=True,
            created_at=timestamp,
            updated_at=timestamp,
        ),
        IconTemplate(
            template_id="glassmorphism",
            name="毛玻璃风格",
            description="磨砂玻璃质感与半透明层次，底层透出绚丽渐变，极具现代 UI 质感。",
            prompt_template=(
                "A Windows folder icon of {{subject}}, glassmorphism style, "
                "frosted glass texture, translucent layers, soft blur, vibrant gradients underneath, modern UI design, no text, transparent background"
            ),
            cover_image="/template-covers/glassmorphism.webp",
            is_builtin=True,
            created_at=timestamp,
            updated_at=timestamp,
        ),
        IconTemplate(
            template_id="cyberpunk",
            name="赛博朋克",
            description="发光霓虹线条与深色背景，青色和洋红配色，带来强烈的未来科幻感。",
            prompt_template=(
                "A Windows folder icon of {{subject}}, cyberpunk style, "
                "glowing neon lines, dark background, futuristic vibes, cyan and magenta color palette, high contrast, no text, transparent background"
            ),
            cover_image="/template-covers/cyberpunk.webp",
            is_builtin=True,
            created_at=timestamp,
            updated_at=timestamp,
        ),
        IconTemplate(
            template_id="low_poly",
            name="低多边形",
            description="几何切面与锐利边缘组合，极简且富有立体感的扁平鲜艳色彩。",
            prompt_template=(
                "A Windows folder icon of {{subject}}, low poly style, "
                "geometric facets, sharp edges, minimalist, faceted 3D art, vibrant flat colors, no text, transparent background"
            ),
            cover_image="/template-covers/low_poly.webp",
            is_builtin=True,
            created_at=timestamp,
            updated_at=timestamp,
        ),
        IconTemplate(
            template_id="paper_cut",
            name="剪纸艺术",
            description="层叠纸张质感与深邃阴影，精致的立体手工艺表现，层次感极强。",
            prompt_template=(
                "A Windows folder icon of {{subject}}, paper cutout art style, "
                "layered paper texture, deep shadows, craft paper aesthetic, subtle gradients, dimensional look, no text, transparent background"
            ),
            cover_image="/template-covers/paper_cut.webp",
            is_builtin=True,
            created_at=timestamp,
            updated_at=timestamp,
        ),
        IconTemplate(
            template_id="pixel_art",
            name="复古像素",
            description="8-bit 经典复古游戏美学，清晰的锐利像素边缘，充满怀旧气息。",
            prompt_template=(
                "A Windows folder icon of {{subject}}, pixel art style, "
                "8-bit retro game aesthetic, sharp pixels, vibrant palette, nostalgic, no text, transparent background"
            ),
            cover_image="/template-covers/pixel_art.webp",
            is_builtin=True,
            created_at=timestamp,
            updated_at=timestamp,
        ),
        IconTemplate(
            template_id="watercolor",
            name="水彩手绘",
            description="柔和边缘与艺术性的水墨喷溅感，适合清新文艺类的目录呈现。",
            prompt_template=(
                "A Windows folder icon of {{subject}}, watercolor painting style, "
                "soft edges, artistic splashes, hand-painted texture, on white paper background, no text, transparent background"
            ),
            cover_image="/template-covers/watercolor.webp",
            is_builtin=True,
            created_at=timestamp,
            updated_at=timestamp,
        ),
        IconTemplate(
            template_id="minimalist_line",
            name="极简线稿",
            description="纯细线描绘，抽象、干净且优雅，毫不繁复。",
            prompt_template=(
                "A Windows folder icon of {{subject}}, minimalist line art, "
                "continuous black line drawing on white background, abstract, clean, elegant, no text, transparent background"
            ),
            cover_image="/template-covers/minimalist_line.webp",
            is_builtin=True,
            created_at=timestamp,
            updated_at=timestamp,
        ),
        IconTemplate(
            template_id="ukiyo_e",
            name="浮世绘画",
            description="传统日本木版画风格，粗犷的黑色轮廓与扁平透视，纸张纹理感十足。",
            prompt_template=(
                "A Windows folder icon of {{subject}}, Ukiyo-e style, "
                "traditional Japanese woodblock print, bold outlines, flat perspective, textured paper, no text, transparent background"
            ),
            cover_image="/template-covers/ukiyo_e.webp",
            is_builtin=True,
            created_at=timestamp,
            updated_at=timestamp,
        ),
        IconTemplate(
            template_id="vaporwave",
            name="蒸汽波艺术",
            description="80年代复古美学，故障艺术效果与古典元素，粉蓝渐变营造迷幻感。",
            prompt_template=(
                "A Windows folder icon of {{subject}}, vaporwave aesthetic, "
                "retro 80s style, glitched effects, statue busts, palm trees, pink and blue gradients, no text, transparent background"
            ),
            cover_image="/template-covers/vaporwave.webp",
            is_builtin=True,
            created_at=timestamp,
            updated_at=timestamp,
        ),
        IconTemplate(
            template_id="industrial_metal",
            name="工业重金属",
            description="拉丝钢纹理与金属反射光泽，布满螺栓与铆钉，重型机械视觉冲击。",
            prompt_template=(
                "A Windows folder icon of {{subject}}, industrial metal style, "
                "brushed steel texture, metallic reflections, bolts and rivets, heavy machinery look, no text, transparent background"
            ),
            cover_image="/template-covers/industrial_metal.webp",
            is_builtin=True,
            created_at=timestamp,
            updated_at=timestamp,
        ),
        IconTemplate(
            template_id="pop_art",
            name="波普艺术",
            description="流行漫画美学，半色调网点与粗黑轮廓，对比强烈的明艳原色。",
            prompt_template=(
                "A Windows folder icon of {{subject}}, Pop Art style, "
                "comic book aesthetic, halftones, bold black outlines, vibrant primary colors, Andy Warhol vibe, no text, transparent background"
            ),
            cover_image="/template-covers/pop_art.webp",
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

