from __future__ import annotations

from pathlib import Path

from file_organizer.analysis import service as analysis_service
from file_organizer.app.session_service import OrganizerSessionService
from file_organizer.app.session_store import SessionStore
from file_organizer.cli.console import default_cli
from file_organizer.cli.event_printer import scanner_ui_handler
from file_organizer.shared.config import ANALYSIS_MODEL_NAME, ORGANIZER_MODEL_NAME, PROJECT_ROOT, RESULT_FILE_PATH


EXIT_REPLIES = {"quit", "exit"}
EXECUTE_REPLIES = {"执行", "yes", "y", "ok", "okay"}


def _prompt_text(cli, method_name: str, message: str, *, input_func=input) -> str:
    prompt_method = getattr(cli, method_name, None)
    if callable(prompt_method):
        result = prompt_method(message, input_func=input_func)
        if isinstance(result, str):
            return result
    prompt = getattr(cli, "prompt", None)
    if callable(prompt):
        result = prompt(message, input_func=input_func)
        if isinstance(result, str):
            return result
    return input_func(message)


def _normalize_reply(text: str) -> str:
    return (text or "").strip().lower()


def _is_exit_reply(text: str) -> bool:
    return _normalize_reply(text) in EXIT_REPLIES


def _is_execute_reply(text: str) -> bool:
    return _normalize_reply(text) in EXECUTE_REPLIES


def run_session_pipeline(
    input_func=input,
    cli=default_cli,
    service: OrganizerSessionService | None = None,
    *,
    path_exists=None,
):
    service = service or OrganizerSessionService(SessionStore(Path("output/sessions")))
    path_exists = path_exists or (lambda path: Path(path).is_dir())
    cli.show_app_header(PROJECT_ROOT, ANALYSIS_MODEL_NAME, ORGANIZER_MODEL_NAME)

    target_dir = _prompt_text(cli, "prompt_path", "请输入要分析的目录绝对路径", input_func=input_func).strip()
    if not target_dir:
        return
    if not path_exists(target_dir):
        cli.error(f"'{target_dir}' 不是一个有效目录。", title="输入错误")
        return

    create_result = service.create_session(target_dir, resume_if_exists=True)
    if create_result.mode == "resume_available":
        session = service.resume_session(create_result.restorable_session.session_id)
        cli.info("已恢复上次未完成的整理会话。", title="继续整理")
    else:
        session = create_result.session

    if not session.scan_lines or session.stage in {"draft", "stale", "interrupted"}:
        cli.stage("执行目录扫描分析", style="blue")
        service.start_scan(
            session.session_id,
            scan_runner=lambda path: analysis_service.run_analysis_cycle(path, event_handler=scanner_ui_handler),
        )
        cli.show_saved_result(RESULT_FILE_PATH)

    while True:
        snapshot = service.get_snapshot(session.session_id)
        assistant_message = snapshot.get("assistant_message") or {}
        if assistant_message.get("content"):
            cli.info(assistant_message["content"], title="AI 助手")

        if snapshot["stage"] == "completed":
            report = snapshot.get("execution_report") or {}
            cli.success(
                f"整理已完成：成功 {report.get('success_count', 0)} 项，失败 {report.get('failure_count', 0)} 项。",
                title="执行完成",
            )
            break

        prompt = "请输入整理意见 (quit 退出)"
        if snapshot["stage"] in {"ready_for_precheck", "planning"}:
            prompt = "可继续输入整理意见；输入 执行 进入预检 (quit 退出)"
        if snapshot["stage"] in {"stale", "interrupted"}:
            prompt = "当前计划需要刷新后再继续，请输入意见或 quit 退出"

        user_text = _prompt_text(cli, "prompt_feedback", prompt, input_func=input_func).strip()
        if not user_text:
            continue
        if _is_exit_reply(user_text):
            break

        if _is_execute_reply(user_text):
            precheck_result = service.run_precheck(session.session_id)
            precheck = precheck_result.session_snapshot.get("precheck_summary") or {}
            if precheck.get("can_execute") or precheck_result.session_snapshot.get("stage") == "ready_to_execute":
                confirm_text = _prompt_text(
                    cli,
                    "prompt_confirmation",
                    "输入 YES 执行当前整理方案",
                    input_func=input_func,
                ).strip()
                if confirm_text == "YES":
                    service.execute(session.session_id, confirm=True)
                    continue
                if _is_exit_reply(confirm_text):
                    break
            else:
                cli.warning("预检未通过，请继续调整。", title="预检失败")
            continue

        service.submit_user_intent(session.session_id, user_text)
