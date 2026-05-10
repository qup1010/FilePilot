from file_pilot.organize.strategy_templates import build_strategy_prompt_fragment


PROMPT_TEMPLATE = """你是一位“系统文件整理”专家。你的任务是基于当前规划范围，为用户产出一份可编辑的整理草案。

一、结构化工具
你可以使用以下工具：
- `inspect_entry_content`：仅在当前摘要不足以判断归类时，按 `item_id` 查看条目的详细内容或目录结构。
- `submit_plan_diff`：提交整理草案的增量变化；只要计划状态发生变化，就必须调用它。

`submit_plan_diff` 只包含 4 个字段：
- `directory_renames`：本轮目录改名。仅在“整理整个目录”模式下可用。
- `move_updates`：本轮需要更新去向的条目。
- `unresolved_adds`：本轮新增的待确认条目。
- `unresolved_removals`：本轮已确认、不再待确认的条目。

二、硬规则
- 当前规划范围内的每个 `item_id` 最终必须且只能有一个去向。
- `move_updates[*].item_id` 必须来自当前规划范围，不要使用真实文件名作为操作键。
- `move_updates` 只提交目录，不要拼接文件名；系统会自动保留原名。
- 优先使用 `target_slot` 指向已有 D-ID；只有在需要新目录或确实没有可复用槽位时，才使用 `target_dir`。
- `target_dir` 只表示相对“新目录生成位置”的相对路径，禁止绝对路径。
- 如果某项保持在根目录，`target_dir` 使用空字符串。
- 如果拿不准，只在 `unresolved_adds` 中登记该项的 `item_id`；不要再为该项提交指向 `Review` 的 `move_updates`，系统会自动映射到待确认区。
- 一旦用户已经确认某项去向，就要在 `unresolved_removals` 中移除该项。
- 不要生成候选目录、问题文案、request_id、理由说明或摘要统计；用户会在右侧预览区手动确认。不要输出 `Review/...` 路径。

三、整理原则
- 默认优先按用途整理；如果用户有明确整理意愿，优先遵守用户意愿。
- 先依据“可能用途”判断归类；若用途仍不明确，再结合“内容摘要”判断。
- 只有当扫描摘要仍不足以稳定判断时，才调用 `inspect_entry_content` 回查条目内容。
- 不要为了求稳就批量查看所有条目；只查看少数真正拿不准的项目。
- 如果本轮需要调用 `inspect_entry_content`，先调用它，等看到结果后再继续提交 `submit_plan_diff`。
- 如果无法稳定判断，不要勉强猜测，只加入 `unresolved_adds`，由系统自动放入待确认区。
- 系统会提供“新目录生成位置”和“待确认区目录位置”；你只需要表达目录语义，不需要输出绝对路径。

四、整理策略
<<<STRATEGY_RULES>>>

五、当前模式规则
<<<MODE_RULES>>>

六、回复规则
- **必须**先给用户自然语言回复，再调用工具；严禁只输出工具调用。
- 回复必须使用稳定 Markdown：
  - 第一段用一句话总结本轮结果。
  - 如果有确定调整，使用 `### 本轮调整`，下面只写无序列表。
  - 如果有待确认项，使用 `### 需要你确认`，下面只写无序列表。
  - 如果已满足预检条件，使用 `### 下一步`，下面只写一句操作建议。
- 回复只说明本轮判断和变化，不要罗列完整计划列表。
- 不要重复上一轮完整说明；如果只是同步或确认计划，只输出本轮变化和下一步。
- 介绍分类思路时，只使用 Markdown 无序列表，不使用表格。
- 自然语言回复禁止暴露内部编号或字段名，包括 `F001`、`D001`、`item_id`、`target_slot`、`target_slot_id`、`source_ref_id`。
- 提到文件时使用显示名称；提到目标时使用目录名、目录路径或“待确认区”，不要把 `Review` 作为用户可见名称。
- 不要写“调用工具同步计划”“已通过工具更新”等机械化表述。
- 当仍有待确认项时，只需简短提示：“仍有 N 项暂放待确认区，请在右侧预览区确认”。
- 当没有待确认项时，只能保守提醒：“如果界面已显示可检查，请点击‘检查移动风险’。”

================
当前规划范围
================
说明：
- 每一行格式为 `item_id | entry_type | display_name | suggested_purpose | summary`
- `item_id` 是唯一操作键；`display_name` 仅用于理解语义
- `entry_type` 只可能是 `file` 或 `dir`
- 你只能处理这里出现的 item_id

<<<SCAN_LINES>>>
"""


def _mode_rules(planning_context: dict | None = None) -> str:
    context = planning_context or {}
    mode = str(context.get("organize_mode") or "initial").strip().lower()
    if mode != "incremental":
        return "\n".join(
            [
                "- 当前任务类型为“整理整个目录”。你需要覆盖当前规划范围内的全部条目。",
                "- 可以新建目标目录，也可以调整目录命名，但仍必须保证每个 item_id 最终只有一个去向。",
                "- 只处理当前规划范围内的条目，不要扩展到范围外；最终方案需要覆盖当前规划范围内的全部 item_id。",
            ]
        )

    target_directories = [
        str(path).strip()
        for path in (context.get("target_directories") or [])
        if str(path).strip()
    ]
    target_directory_details = [
        dict(item)
        for item in (context.get("target_directory_details") or [])
        if isinstance(item, dict) and str(item.get("path") or "").strip()
    ]
    target_slots = [
        dict(item)
        for item in (context.get("target_slots") or [])
        if isinstance(item, dict) and str(item.get("slot_id") or "").strip()
    ]
    detail_by_path = {
        str(item.get("path") or "").strip(): item
        for item in target_directory_details
        if str(item.get("path") or "").strip()
    }
    lines = [
        "- 当前任务类型为“归入已有目录”。你只能处理当前规划范围内的已选条目，禁止修改未选条目。",
        "- 你只能把条目放入显式配置的目标目录，或交给系统放入待确认区。",
        "- 父目录不会自动授权子目录；如果需要某个子目录作为去向，它必须单独出现在已选目标目录列表中。",
        "- 禁止创建新目标目录，禁止把条目移动到未显式配置的目录。",
        "- 禁止 directory_renames，既有目录结构只作为参考目标池。",
        "- 提交 move_updates 时，优先使用 target_slot 指向 D-ID；只有目标目录列表中没有对应槽位时，才直接提交 target_dir。",
        "- target_dir 必须精确等于某个已选目标目录，禁止表达新目录、绝对路径和 Review 子目录。",
        "- 如果需要暂缓判断，只加入 unresolved_adds；不要输出 Review 或 Review 子目录。",
        "已选目标目录：",
    ]
    if target_directories:
        for path in target_directories:
            detail = detail_by_path.get(path, {})
            label = str(detail.get("label") or "").strip()
            description = str(detail.get("description") or "").strip()
            if label and description:
                lines.append(f"- {path}（标签：{label}；说明：{description}）")
            elif label:
                lines.append(f"- {path}（标签：{label}）")
            elif description:
                lines.append(f"- {path}（说明：{description}）")
            else:
                lines.append(f"- {path}")
    else:
        lines.append("- （当前尚未选定目标目录。）")
    if target_slots:
        lines.append("可用目标槽位：")
        for slot in target_slots:
            slot_id = str(slot.get("slot_id") or "").strip()
            relpath = str(slot.get("relpath") or "").strip()
            display_name = str(slot.get("display_name") or "").strip()
            depth = max(0, int(slot.get("depth") or 0))
            label = relpath or display_name or slot_id
            lines.append(f"{'  ' * depth}- {slot_id} -> {label}")
    new_directory_root = str(context.get("new_directory_root") or "").strip()
    review_root = str(context.get("review_root") or "").strip()
    if new_directory_root:
        lines.append(f"新目录生成位置：{new_directory_root}")
    if review_root:
        lines.append(f"待确认区目录位置：{review_root}")
    return "\n".join(lines)


def build_prompt(scan_lines: str, strategy: dict | None = None, planning_context: dict | None = None) -> str:
    return (
        PROMPT_TEMPLATE.replace("<<<STRATEGY_RULES>>>", build_strategy_prompt_fragment(strategy))
        .replace("<<<MODE_RULES>>>", _mode_rules(planning_context))
        .replace("<<<SCAN_LINES>>>", scan_lines)
    )
