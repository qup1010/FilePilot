import unittest
from types import SimpleNamespace
from unittest import mock

from file_organizer.organize.models import FinalPlan, PendingPlan, PlanMove
from file_organizer.organize import service as organizer_service


class StructuredOrganizerServiceTests(unittest.TestCase):
    def test_validate_final_plan_accepts_valid_sequence(self):
        scan_lines = "合同.pdf | 财务/合同 | 付款协议\n截图1.png | 截图记录 | 报错界面"
        final_plan = FinalPlan(
            directories=["Finance", "Screenshots"],
            moves=[
                PlanMove(source="合同.pdf", target="Finance/合同.pdf"),
                PlanMove(source="截图1.png", target="Screenshots/截图1.png"),
            ],
            unresolved_items=[],
        )

        validation = organizer_service.validate_final_plan(scan_lines, final_plan)

        self.assertTrue(validation["is_valid"])

    def test_render_final_plan_commands_preserves_compatible_text(self):
        final_plan = FinalPlan(
            directories=["Finance"],
            moves=[PlanMove(source="合同.pdf", target="Finance/合同.pdf")],
            unresolved_items=[],
        )

        rendered = organizer_service.render_final_plan_commands(final_plan)

        self.assertIn('<COMMANDS>', rendered)
        self.assertIn('MKDIR "Finance"', rendered)
        self.assertIn('MOVE "合同.pdf" "Finance/合同.pdf"', rendered)

    def test_apply_plan_diff_updates_moves_derives_directories_and_tracks_unresolved_changes(self):
        old_plan = PendingPlan(
            moves=[
                PlanMove(source="合同.pdf", target="Finance/合同.pdf"),
                PlanMove(source="截图1.png", target="Review/截图1.png"),
            ],
            unresolved_items=["截图1.png"],
        )
        diff = {
            "directory_renames": [{"from": "Finance", "to": "Bills"}],
            "move_updates": [{"source": "截图1.png", "target": "Screenshots/截图1.png"}],
            "unresolved_adds": ["合同.pdf"],
            "unresolved_removals": ["截图1.png"],
            "summary": "已按要求改名并调整截图归类",
        }

        updated, diff_summary = organizer_service.apply_plan_diff(old_plan, diff)

        self.assertEqual(updated.directories, ["Bills", "Screenshots"])
        self.assertEqual(
            {move.source: move.target for move in updated.moves},
            {
                "合同.pdf": "Bills/合同.pdf",
                "截图1.png": "Screenshots/截图1.png",
            },
        )
        self.assertEqual(updated.unresolved_items, ["合同.pdf"])
        self.assertEqual(updated.summary, "已按要求改名并调整截图归类")
        self.assertTrue(any("Bills" in item for item in diff_summary))
        self.assertTrue(any("Screenshots/截图1.png" in item for item in diff_summary))

    def test_run_organizer_cycle_returns_display_request_without_mutating_plan(self):
        display_call = SimpleNamespace(
            function=SimpleNamespace(
                name="present_current_plan",
                arguments='{"focus": "details", "summary": "请先看当前计划"}',
            )
        )
        message = SimpleNamespace(content="我先给你看看当前计划。", tool_calls=[display_call])
        current_plan = PendingPlan(
            directories=["Finance"],
            moves=[PlanMove(source="合同.pdf", target="Finance/合同.pdf")],
            unresolved_items=["截图1.png"],
        )

        with mock.patch.object(organizer_service, "chat_one_round", return_value=message):
            content, result = organizer_service.run_organizer_cycle(
                messages=[],
                scan_lines="合同.pdf | 财务/合同 | 付款协议",
                pending_plan=current_plan,
            )

        self.assertEqual(content, "我先给你看看当前计划。")
        self.assertIs(result["pending_plan"], current_plan)
        self.assertEqual(result["display_plan"], {"focus": "details", "summary": "请先看当前计划"})
        self.assertFalse(result["is_valid"])

    def test_run_organizer_cycle_auto_displays_summary_after_diff_when_model_omits_present_tool(self):
        diff_call = SimpleNamespace(
            function=SimpleNamespace(
                name="submit_plan_diff",
                arguments='{"directory_renames": [], "move_updates": [{"source": "合同.pdf", "target": "Study/合同.pdf"}, {"source": "截图1.png", "target": "Review/截图1.png"}], "unresolved_adds": ["截图1.png"], "unresolved_removals": [], "summary": "先按用途归类"}',
            )
        )
        message = SimpleNamespace(content="", tool_calls=[diff_call])

        with mock.patch.object(organizer_service, "chat_one_round", return_value=message):
            _, result = organizer_service.run_organizer_cycle(
                messages=[],
                scan_lines="合同.pdf | 财务/合同 | 付款协议\n截图1.png | 截图记录 | 报错界面",
                pending_plan=PendingPlan(),
            )

        self.assertFalse(result["is_valid"])
        self.assertEqual(result["display_plan"], {"focus": "summary", "summary": "先按用途归类"})
        self.assertEqual(result["pending_plan"].directories, ["Review", "Study"])
        self.assertEqual(
            {move.source: move.target for move in result["pending_plan"].moves},
            {"合同.pdf": "Study/合同.pdf", "截图1.png": "Review/截图1.png"},
        )
    def test_chat_one_round_emits_wait_events_before_stream_output(self):
        response = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="先讨论整理方案。", tool_calls=[]))]
        )
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=mock.Mock(return_value=response))))
        events = []

        with mock.patch.object(organizer_service, "create_openai_client", return_value=client):
            result = organizer_service.chat_one_round(
                [{"role": "user", "content": "请整理"}],
                event_handler=lambda event, data=None: events.append(event),
            )

        self.assertEqual(result, "先讨论整理方案。")
        self.assertEqual(events[:3], ["model_wait_start", "model_wait_end", "ai_streaming_start"])


if __name__ == "__main__":
    unittest.main()


