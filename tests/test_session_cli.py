import unittest
from pathlib import Path
from unittest import mock

from file_organizer.cli.session_cli import run_session_pipeline


class SessionCliTests(unittest.TestCase):
    def test_run_session_pipeline_uses_session_service_for_scan_plan_precheck_and_execute(self):
        cli = mock.Mock()
        service = mock.Mock()
        service.create_session.return_value = mock.Mock(
            mode="created",
            session=mock.Mock(session_id="sess-1", scan_lines="", stage="draft"),
            restorable_session=None,
        )
        service.get_snapshot.side_effect = [
            {"stage": "planning", "assistant_message": None},
            {"stage": "ready_for_precheck", "assistant_message": None},
            {"stage": "completed", "assistant_message": None, "execution_report": {"success_count": 1, "failure_count": 0}},
        ]
        service.run_precheck.return_value = mock.Mock(session_snapshot={"stage": "ready_to_execute"})
        service.execute.return_value = mock.Mock(
            session_snapshot={"stage": "completed", "execution_report": {"success_count": 1, "failure_count": 0}}
        )
        responses = iter(["D:/demo", "放到文档", "执行", "YES"])

        run_session_pipeline(
            input_func=lambda prompt="": next(responses),
            cli=cli,
            service=service,
            path_exists=lambda path: True,
        )

        service.start_scan.assert_called_once()
        service.submit_user_intent.assert_called_once_with("sess-1", "放到文档")
        service.run_precheck.assert_called_once_with("sess-1")
        service.execute.assert_called_once_with("sess-1", confirm=True)

    def test_run_session_pipeline_resumes_existing_session_before_prompt_loop(self):
        cli = mock.Mock()
        service = mock.Mock()
        restorable = mock.Mock(session_id="sess-2")
        resumed_session = mock.Mock(session_id="sess-2", scan_lines="a.txt | 文档 | A", stage="planning")
        service.create_session.return_value = mock.Mock(
            mode="resume_available",
            session=None,
            restorable_session=restorable,
        )
        service.resume_session.return_value = resumed_session
        service.get_snapshot.return_value = {"stage": "planning", "assistant_message": None}
        responses = iter(["D:/demo", "quit"])

        run_session_pipeline(
            input_func=lambda prompt="": next(responses),
            cli=cli,
            service=service,
            path_exists=lambda path: True,
        )

        service.resume_session.assert_called_once_with("sess-2")
        service.start_scan.assert_not_called()
        service.submit_user_intent.assert_not_called()


if __name__ == "__main__":
    unittest.main()
