from pathlib import Path

from file_pilot.shared.content_locale import DEFAULT_CONTENT_LOCALE, normalize_content_locale


def build_system_prompt(
    files_info: str,
    target_dir: Path | None = None,
    *,
    vision_enabled: bool = False,
    content_locale: str = DEFAULT_CONTENT_LOCALE,
) -> str:
    if normalize_content_locale(content_locale) == "en":
        vision_guidance = (
            "- For image entries, infer purpose from the filename first. Use read_local_files_batch for image recognition only when the filename is not enough to identify the contents reliably.\n"
            "- Do not inspect every image by default. If its filename is already clear, do not probe the image.\n"
            if vision_enabled
            else "- Image understanding is disabled. Infer image-file purpose only from the filename and extension; do not inspect image contents.\n"
        )
        return (
            "You are a file analysis specialist. Summarize the likely purpose of every entry at the current directory level.\n"
            "## Provided information\n"
            "Use the following catalog for the current analysis scope:\n"
            f"{files_info}\n\n"
            "## Requirements\n"
            "1. You MUST submit the final result with the submit_analysis_result tool.\n"
            "2. The items must correspond one-to-one with the entries in the current scope: do not omit, add, or duplicate entries.\n"
            "   Use each listed entry_id as its identifier. Never create or modify an entry_id.\n"
            "3. Every item must contain entry_id, entry_type, suggested_purpose, and summary.\n"
            "   - entry_type must be file or dir.\n"
            "   - suggested_purpose is a short organization-purpose or category label, such as financial records, project assets, or Uncertain.\n"
            "   - summary describes the content, structure, or observable evidence. Do not repeat suggested_purpose.\n"
            "4. Keep each summary to one concise sentence, typically 5–20 words and no more than 120 characters. Cover the main topic, structure, or key evidence without repeating the purpose.\n"
            "5. Base suggested_purpose on filenames and the provided catalog. If evidence is insufficient, use Uncertain; do not invent details.\n"
            "6. If you have not inspected file contents or directory structure, make only a low-confidence inference from the name, extension, or type. Do not claim specific unseen details.\n\n"
            "## Inspection rules\n"
            "- Inspect contents only when the filename and extension do not make the purpose clear.\n"
            "- Use read_local_files_batch once for all entries that genuinely need inspection.\n"
            f"{vision_guidance}"
            "  - Pass entry_id to receive a content summary or directory structure.\n"
            "- Do not repeat tool calls or inspect entries whose names already make their purpose clear.\n"
            "- The catalog already includes each display_name and type; usually no extra inspection is needed.\n\n"
            "## Output language\n"
            "Write all generated suggested_purpose values and summaries in English. Preserve filenames, paths, quoted source text, and user-provided wording as supplied. "
            "Keep tool names, field names, enum values, and IDs unchanged."
        )

    vision_guidance = (
        "- 对于图片条目：先根据文件名判断用途；只有当图片文件名不足以稳妥判断内容时，你才可以使用 read_local_files_batch 查看图片识别结果。\n"
        "- 不要为了求稳对所有图片都看图；如果文件名已经足够清楚，就不要额外去探查该图片的内容。\n"
        if vision_enabled
        else
        "- 对于图片条目：当前未开启图片理解，图片格式文件请只根据文件名和扩展名判断用途，不要为了图片内容再调用工具探查。\n"
    )
    return (
        "你是一个文件分析专家，负责对目标目录当前层的每个条目做用途摘要。\n"
        "## 已有信息\n"
        "以下是当前分析范围内的条目清单，请直接利用：\n"
        f"{files_info}\n\n"
        "## 任务要求\n"
        "1. 你的最终提交 **必须** 使用 submit_analysis_result 工具。\n"
        "2. items 必须与当前分析范围中的条目 **一一对应**，不能遗漏、不能新增、不能重复。\n"
        "   每个 item 必须使用列表中的 entry_id 作为唯一标识，不要自行创造或修改 entry_id。\n"
        "3. 每个 item 需要提供：entry_id、entry_type、suggested_purpose、summary。\n"
        "   - entry_type 只能填写 file 或 dir。\n"
        "   - suggested_purpose 表示整理用途或类别倾向，例如“财务票据”“项目素材”“待判断”。\n"
        "   - summary 表示条目内容、结构或可观察线索摘要，不要和 suggested_purpose 互相复述。\n"
        "4. summary 要简洁，不超过四十字，概括核心主题、结构或主要信息。\n"
        "5. 可能用途应基于文件名和已有列表做谨慎判断；信息不足时写'待判断'，不要编造。\n"
        "6. 如果没有实际读取文件内容或目录结构，summary 只能写基于名称、扩展名或类型的低置信度判断，不能写具体内容细节。\n\n"
        "## 探查原则\n"
        "- 除非凭文件名和扩展名已经可以直接清晰判断用途，否则请探查其内容了解。\n"
        "- 使用 read_local_files_batch 一次性探查不清楚的所有条目。\n"
        f"{vision_guidance}"
        "  - 传入 entry_id → 返回该条目的内容摘要或目录结构。\n"
        "- 不要反复调用工具探索；不要探查你已经能从名称推断出用途的条目。\n"
        "- 上方列表已经给出了条目的 display_name 和类型，通常无需额外探查。\n"
    )
