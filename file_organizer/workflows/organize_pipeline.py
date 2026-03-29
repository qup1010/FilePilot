import os
from pathlib import Path

from file_organizer.analysis import service as analysis_service
from file_organizer.cli.console import default_cli
from file_organizer.cli.event_printer import scanner_ui_handler
from file_organizer.execution import service as execution_service
from file_organizer.organize import service as organize_service
from file_organizer.organize.models import FinalPlan, PendingPlan, PlanMove
from file_organizer.shared.config import ANALYSIS_MODEL_NAME, ORGANIZER_MODEL_NAME, PROJECT_ROOT, RESULT_FILE_PATH


EXIT_REPLIES = {"quit", "exit"}
AFFIRMATIVE_REPLIES = {
    "yes",
    "y",
    "ok",
    "okay",
    "可以",
    "可",
    "行",
    "好",
    "好的",
    "同意",
    "确认",
    "没问题",
    "就这样",
    "按这个来",
    "通过",
}
EXECUTE_REPLIES = {"执行", "开始执行", "开始整理"}
DETAIL_VIEW_REPLIES = {"看明细", "查看明细", "查看方案", "看方案", "展开"}
CHANGE_VIEW_REPLIES = {"看改动", "只看改动", "本轮变化", "看变化"}
UNRESOLVED_VIEW_REPLIES = {"看待确认项", "看待确认", "看未决项", "看问题"}


def _prompt_text(cli, method_name: str, message: str, *, input_func=input) -> str:
    prompt_method = getattr(cli, method_name, None)
    if callable(prompt_method):
        result = prompt_method(message, input_func=input_func)
        if isinstance(result, str):
            return result
    return cli.prompt(message, input_func=input_func)


def _normalize_reply(text: str) -> str:
    return (text or "").strip().lower()


def _is_exit_reply(text: str) -> bool:
    return _normalize_reply(text) in EXIT_REPLIES


def _is_affirmative_reply(text: str) -> bool:
    return _normalize_reply(text) in AFFIRMATIVE_REPLIES


def _is_execute_reply(text: str) -> bool:
    return _normalize_reply(text) in EXECUTE_REPLIES


def _pending_to_final_plan(pending_plan: PendingPlan, *, clear_unresolved: bool = False) -> FinalPlan:
    return FinalPlan(
        directories=list(pending_plan.directories),
        moves=[PlanMove(source=move.source, target=move.target, raw=move.raw) for move in pending_plan.moves],
        unresolved_items=[] if clear_unresolved else list(pending_plan.unresolved_items),
        summary=pending_plan.summary,
    )


def _all_unresolved_default_to_review(pending_plan: PendingPlan) -> bool:
    move_targets = {move.source: move.target for move in pending_plan.moves}
    return all(move_targets.get(item, "").startswith("Review/") for item in pending_plan.unresolved_items)


def _build_candidate_final_plan(pending_plan: PendingPlan) -> FinalPlan | None:
    if pending_plan.unresolved_items and not _all_unresolved_default_to_review(pending_plan):
        return None
    return _pending_to_final_plan(pending_plan, clear_unresolved=True)


def _run_organizer_cycle_with_state(organizer_module, messages, scan_lines, *, pending_plan, user_constraints, event_handler):
    try:
        return organizer_module.run_organizer_cycle(
            messages,
            scan_lines,
            pending_plan=pending_plan,
            user_constraints=user_constraints,
            event_handler=event_handler,
        )
    except TypeError:
        return organizer_module.run_organizer_cycle(messages, scan_lines, event_handler=event_handler)


def _show_plan_diff(cli, diff_summary: list[str]) -> None:
    show_method = getattr(cli, "show_plan_diff", None)
    if callable(show_method):
        show_method(diff_summary)
    elif diff_summary:
        cli.show_list("计划变化", diff_summary, style="blue")


def _show_pending_plan(cli, pending_plan, display_plan: dict | None) -> None:
    if not pending_plan or not display_plan:
        return
    show_method = getattr(cli, "show_pending_plan", None)
    if callable(show_method):
        show_method(
            pending_plan,
            focus=display_plan.get("focus", "summary"),
            summary=display_plan.get("reason") or display_plan.get("summary") or "",
        )


def _detect_local_view_intent(text: str) -> str | None:
    normalized = _normalize_reply(text)
    if normalized in DETAIL_VIEW_REPLIES:
        return "details"
    if normalized in CHANGE_VIEW_REPLIES:
        return "changes"
    if normalized in UNRESOLVED_VIEW_REPLIES:
        return "unresolved"
    return None


def _handle_execution_step(
    *,
    cli,
    execution_module,
    final_plan: FinalPlan,
    target_dir: Path,
    input_func,
    user_constraints: list[str],
    messages: list[dict],
):
    plan = execution_module.build_execution_plan(final_plan, target_dir)
    precheck = execution_module.validate_execution_preconditions(plan)
    cli.show_execution_preview(plan, precheck)

    if not precheck.can_execute:
        user_text = _prompt_text(
            cli,
            "prompt_feedback",
            "预检查未通过，请输入修改意见 (quit 退出)",
            input_func=input_func,
        ).strip()
        if not user_text:
            return "continue"
        if _is_exit_reply(user_text):
            return "break"
        user_constraints.append(user_text)
        messages.append({"role": "user", "content": user_text})
        return "continue"

    confirm_text = _prompt_text(
        cli,
        "prompt_confirmation",
        "输入 YES 执行；其他任意输入继续讨论 (quit 退出)",
        input_func=input_func,
    ).strip()
    if not confirm_text:
        return "continue"
    if _is_exit_reply(confirm_text):
        return "break"
    if confirm_text == "YES":
        report = execution_module.execute_plan(plan)
        cli.show_execution_report(report, plan.base_dir)

        # 扫描并提示清理遗留空文件夹
        if hasattr(execution_module, "get_empty_source_dirs") and hasattr(execution_module, "cleanup_empty_dirs"):
            empty_dirs = execution_module.get_empty_source_dirs(plan)
            if empty_dirs:
                cleanup_text = _prompt_text(
                    cli,
                    "prompt_confirmation",
                    f"\n【收尾工作】发现 {len(empty_dirs)} 个源目录已空，是否顺手清理它们？(输入 YES 清理，其他任意输入跳过)",
                    input_func=input_func,
                ).strip()
                if cleanup_text == "YES":
                    cleaned = execution_module.cleanup_empty_dirs(empty_dirs)
                    cli.success(f"成功清理了 {len(cleaned)} 个空文件夹。", title="清理完成")
                    
        return "break"

    user_constraints.append(confirm_text)
    messages.append({"role": "user", "content": confirm_text})
    return "continue"


def run_organize_chat(
    scan_lines,
    target_dir: Path,
    organizer_module=organize_service,
    execution_module=execution_service,
    input_func=input,
    print_func=print,
    event_handler=scanner_ui_handler,
    cli=default_cli,
):
    """进入双向整理交互对话。"""
    del print_func
    messages = organizer_module.build_initial_messages(scan_lines)
    pending_plan: PendingPlan | None = None
    user_constraints: list[str] = []
    last_diff_summary: list[str] = []
    skip_model_round = False
    cli.panel("整理调整会话", "系统会根据扫描结果生成整理建议，你可以继续补充要求或调整方案。", style="blue")

    while True:
        try:
            if not skip_model_round:
                cli.stage(f"文件整理助手 ({ORGANIZER_MODEL_NAME})", style="blue")
                display_text, cycle_result = _run_organizer_cycle_with_state(
                    organizer_module,
                    messages,
                    scan_lines,
                    pending_plan=pending_plan,
                    user_constraints=user_constraints,
                    event_handler=event_handler,
                )
                del display_text

                cycle_result = cycle_result or {"is_valid": False}
                pending_plan = cycle_result.get("pending_plan", pending_plan)
                display_plan = cycle_result.get("display_plan")
                diff_summary = cycle_result.get("diff_summary", [])
                last_diff_summary = list(diff_summary)
                if diff_summary and (not display_plan or display_plan.get("focus") == "changes"):
                    _show_plan_diff(cli, diff_summary)

                _show_pending_plan(cli, pending_plan, display_plan)

                if cycle_result.get("repair_mode"):
                    cli.warning("命令流多次失败，已根据权威分析结构重建整理计划。", title="修复模式")

                if cycle_result.get("is_valid"):
                    final_plan = cycle_result.get("final_plan")
                    action = _handle_execution_step(
                        cli=cli,
                        execution_module=execution_module,
                        final_plan=final_plan,
                        target_dir=target_dir,
                        input_func=input_func,
                        user_constraints=user_constraints,
                        messages=messages,
                    )
                    if action == "break":
                        break
                    skip_model_round = False
                    continue

            skip_model_round = False

            default_prompt = "您的建议 (quit 退出)"
            if pending_plan and pending_plan.moves:
                if pending_plan.unresolved_items:
                    if _all_unresolved_default_to_review(pending_plan):
                        default_prompt = "可输入 执行 按默认策略将待确认项归入 Review；也可以继续修改 (quit 退出)"
                    else:
                        default_prompt = "请先回答待确认项或输入修改意见 (quit 退出)"
                else:
                    default_prompt = "若同意当前计划请输入 可以/YES 或 执行 进入执行预检；或输入修改意见 (quit 退出)"

            user_text = _prompt_text(cli, "prompt_feedback", default_prompt, input_func=input_func).strip()
            if not user_text:
                continue
            if _is_exit_reply(user_text):
                break

            local_view_intent = _detect_local_view_intent(user_text)
            if local_view_intent and pending_plan:
                summary = pending_plan.summary or "请查看当前整理计划"
                if local_view_intent == "changes" and last_diff_summary:
                    _show_plan_diff(cli, last_diff_summary)
                _show_pending_plan(
                    cli,
                    pending_plan,
                    {"focus": local_view_intent, "summary": summary},
                )
                skip_model_round = True
                continue

            if (_is_execute_reply(user_text) or _is_affirmative_reply(user_text)) and pending_plan and pending_plan.moves:
                candidate_final_plan = _build_candidate_final_plan(pending_plan)
                if candidate_final_plan is None:
                    cli.warning("当前仍有未确认项，而且默认落点不在 Review，请先补充意见再执行。", title="仍需确认")
                    skip_model_round = True
                    continue

                if pending_plan.unresolved_items and _all_unresolved_default_to_review(pending_plan):
                    cli.info("未回答的待确认项将按默认策略归入 Review。", title="采用默认值")

                validate_fn = getattr(organizer_module, "validate_final_plan", None)
                if callable(validate_fn):
                    validation = validate_fn(scan_lines, candidate_final_plan)
                    if not validation.get("is_valid", False):
                        cli.warning("当前计划尚未满足可执行规则，将继续细化。", title="计划未就绪")
                        user_constraints.append(user_text)
                        messages.append({
                            "role": "user",
                            "content": "我认可当前方向。请在不改变已确认归类的前提下，修正并提交最终可执行计划。",
                        })
                        continue

                action = _handle_execution_step(
                    cli=cli,
                    execution_module=execution_module,
                    final_plan=candidate_final_plan,
                    target_dir=target_dir,
                    input_func=input_func,
                    user_constraints=user_constraints,
                    messages=messages,
                )
                if action == "break":
                    break
                continue

            user_constraints.append(user_text)
            messages.append({"role": "user", "content": user_text})

        except KeyboardInterrupt:
            break


def run_pipeline(
    input_func=input,
    print_func=print,
    scanner_module=analysis_service,
    organizer_module=organize_service,
    execution_module=execution_service,
    event_handler=scanner_ui_handler,
    result_file_path=RESULT_FILE_PATH,
    cli=default_cli,
):
    del print_func
    cli.show_app_header(PROJECT_ROOT, ANALYSIS_MODEL_NAME, ORGANIZER_MODEL_NAME)

    target_dir = _prompt_text(cli, "prompt_path", "请输入要分析的目录绝对路径", input_func=input_func).strip()
    if not target_dir:
        return

    path = Path(target_dir)
    if not path.is_dir():
        cli.error(
            f"'{target_dir}' 不是一个有效的目录。\n请输入 Windows 绝对路径，例如: D:/Users/YourName/Documents",
            title="输入错误",
        )
        return

    try:
        cli.stage("执行目录扫描分析", style="blue")
        result = scanner_module.run_analysis_cycle(path, event_handler=event_handler)

        if result:
            if result_file_path.exists():
                result_file_path.unlink()

            scanner_module.append_output_result(result)
            cli.show_saved_result(result_file_path)

            scan_lines = organizer_module.get_scan_content()
            run_organize_chat(
                scan_lines,
                path.resolve(),
                organizer_module=organizer_module,
                execution_module=execution_module,
                input_func=input_func,
                print_func=print,
                event_handler=event_handler,
                cli=cli,
            )
    except Exception as exc:
        cli.error(f"工作流崩溃: {exc}", title="运行失败")
