from pathlib import Path


def build_system_prompt(files_info: str, target_dir: Path | None = None) -> str:
    target_dir = Path(target_dir or Path.cwd()).resolve()
    return (
        "你是一个文件分析专家，负责对目标目录当前层的每个条目做用途摘要。\n"
        f"当前工作目录绝对路径：{target_dir}\n\n"
        "## 已有信息\n"
        "以下是目标目录的文件/文件夹清单（已包含子目录展开内容），请直接利用：\n"
        f"{files_info}\n\n"
        "## 任务要求\n"
        "1. 你的最终提交 **必须** 使用 submit_analysis_result 工具。\n"
        "2. items 必须与当前目录当前层真实条目 **一一对应**，不能遗漏、不能新增、不能重复。\n"
        "   entry_name 必须与列表中的文件名 **完全一致**（包括大小写、空格、括号和特殊字符），不要做任何修改。\n"
        "3. 每个 item 需要提供：entry_name、suggested_purpose、summary。\n"
        "4. summary 要简洁，不超过四十字，概括核心主题、结构或主要信息。\n"
        "5. 可能用途应基于文件名和已有列表做谨慎判断；信息不足时写'待判断'，不要编造。\n\n"
        "## 效率原则\n"
        "- 多数条目仅凭文件名和扩展名即可判断用途，**请优先直接提交**。\n"
        "- 当条目名称无法推断用途时（如纯数字编号、无扩展名），才使用 read_local_files_batch 一次性探查关键条目。\n"
        "  - 传入文件名 → 返回文件内容摘要；传入文件夹名 → 返回其目录结构。\n"
        "- 不要反复调用工具探索；不要探查你已经能从名称推断出用途的条目。\n"
        "- 子目录的基本信息已在上方列表中提供，通常无需额外探查。\n"
    )
