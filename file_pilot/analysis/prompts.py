from pathlib import Path


def build_system_prompt(files_info: str, target_dir: Path | None = None, *, vision_enabled: bool = False) -> str:
    vision_guidance = (
        "- 对于图片条目：先根据文件名判断用途；只有当图片文件名不足以稳妥判断内容时，你才可以使用 read_local_files_batch 查看图片识别结果。\n"
        "- 不要为了求稳就对所有图片都看图；如果文件名已经足够清楚，就不要额外去探查该图片的内容。\n"
        if vision_enabled
        else
        "- 对于图片条目：当前未开启图片理解，图片格式文件请只根据文件名和扩展名判断用途\n"
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
