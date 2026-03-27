import unittest
import json
import os
import shutil
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from file_organizer.organize.models import FinalPlan, PendingPlan, PlanMove
from file_organizer.organize import service as organizer_service


class StructuredOrganizerServiceTests(unittest.TestCase):
    @staticmethod
    def _tool_call(name: str, arguments: str, tool_id: str = "call_1") -> SimpleNamespace:
        return SimpleNamespace(
            id=tool_id,
            type="function",
            function=SimpleNamespace(name=name, arguments=arguments),
        )

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

        updated, diff_summary, _ = organizer_service.apply_plan_diff(old_plan, diff)

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

    def test_run_organizer_cycle_auto_displays_summary_after_diff_when_model_omits_present_tool(self):
        diff_call = SimpleNamespace(
            function=SimpleNamespace(
                name="submit_plan_diff",
                arguments='{"directory_renames": [], "move_updates": [{"source": "合同.pdf", "target": "Study/合同.pdf"}, {"source": "截图1.png", "target": "Review/截图1.png"}], "unresolved_adds": ["截图1.png"], "unresolved_removals": [], "summary": "先按用途归类"}',
            )
        )
        message = SimpleNamespace(content="", tool_calls=[diff_call])

        with mock.patch.object(organizer_service, "chat_one_round", return_value=message):
            content, result = organizer_service.run_organizer_cycle(
                messages=[],
                scan_lines="合同.pdf | 财务/合同 | 付款协议\n截图1.png | 截图记录 | 报错界面",
                pending_plan=PendingPlan(),
            )

        self.assertEqual(content, organizer_service.SYNTHETIC_PLAN_REPLY)
        self.assertFalse(result["is_valid"])
        self.assertEqual(result["display_plan"], {"focus": "summary", "summary": "先按用途归类", "reason": ""})
        self.assertEqual(result["assistant_message"]["content"], organizer_service.SYNTHETIC_PLAN_REPLY)
        self.assertEqual(result["pending_plan"].directories, ["Review", "Study"])
        self.assertEqual(
            {move.source: move.target for move in result["pending_plan"].moves},
            {"合同.pdf": "Study/合同.pdf", "截图1.png": "Review/截图1.png"},
        )

    def test_run_organizer_cycle_returns_unresolved_request_block_without_mutating_plan(self):
        unresolved_call = self._tool_call(
            "request_unresolved_choices",
            '{"request_id":"req_1","summary":"还有 1 个待确认项","items":[{"item_id":"截图1.png","display_name":"截图1.png","question":"更像学习截图还是问题记录？","suggested_folders":["学习资料","截图记录"]}]}',
        )
        current_plan = PendingPlan(
            directories=["Review"],
            moves=[PlanMove(source="截图1.png", target="Review/截图1.png")],
            unresolved_items=["截图1.png"],
        )
        message = SimpleNamespace(content="", tool_calls=[unresolved_call])

        with mock.patch.object(organizer_service, "chat_one_round", return_value=message):
            content, result = organizer_service.run_organizer_cycle(
                messages=[],
                scan_lines="截图1.png | 截图记录 | 报错界面",
                pending_plan=current_plan,
            )

        self.assertEqual(content, "")
        self.assertEqual(result["pending_plan"], current_plan)
        self.assertEqual(result["unresolved_request"]["request_id"], "req_1")
        self.assertEqual(result["assistant_message"]["blocks"][0]["type"], "unresolved_choices")
        self.assertEqual(result["assistant_message"]["blocks"][0]["items"][0]["suggested_folders"], ["学习资料", "截图记录"])

    def test_apply_plan_diff_auto_removes_unresolved_when_moved_to_non_review(self):
        old_plan = PendingPlan(
            moves=[PlanMove(source="合同.pdf", target="Review/合同.pdf")],
            unresolved_items=["合同.pdf"],
        )
        # AI 只更新了路径，忘记显式调用 unresolved_removals
        diff = {
            "directory_renames": [],
            "move_updates": [{"source": "合同.pdf", "target": "Finance/合同.pdf"}],
            "unresolved_adds": [],
            "unresolved_removals": [], 
            "summary": "自动同步测试",
        }
        
        updated, _, _ = organizer_service.apply_plan_diff(old_plan, diff)
        
        # 验证：虽然 AI 忘记传 removals，但因为目标是 Finance/，系统应自动移除待确认标记
        self.assertEqual(updated.unresolved_items, [])
        self.assertEqual(updated.moves[0].target, "Finance/合同.pdf")

    def test_validate_final_plan_blocks_review_path(self):
        scan_lines = "合同.pdf | 财务 | ..."
        final_plan = FinalPlan(
            directories=["Review"],
            moves=[PlanMove(source="合同.pdf", target="Review/合同.pdf")],
            unresolved_items=[],
        )
        
        validation = organizer_service.validate_final_plan(scan_lines, final_plan)
        
        self.assertFalse(validation["is_valid"])
        self.assertTrue(any("Review" in err for err in validation["path_errors"]))

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

    def test_chat_one_round_sanitizes_local_message_metadata_before_calling_model(self):
        response = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="好的", tool_calls=[]))]
        )
        create_mock = mock.Mock(return_value=response)
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create_mock)))
        messages = [
            {"role": "system", "content": "system prompt", "id": "sys_1"},
            {
                "role": "assistant",
                "id": "assistant_1",
                "content": "",
                "blocks": [
                    {
                        "type": "unresolved_choices",
                        "request_id": "req_1",
                        "summary": "请确认归类",
                        "status": "submitted",
                        "items": [
                            {
                                "item_id": "md",
                                "display_name": "md",
                                "question": "放哪里？",
                                "suggested_folders": ["学习资料", "文档资料"],
                            }
                        ],
                        "submitted_resolutions": [
                            {"item_id": "md", "display_name": "md", "selected_folder": "", "note": "这是课程笔记"}
                        ],
                    }
                ],
            },
        ]

        with mock.patch.object(organizer_service, "create_openai_client", return_value=client), mock.patch.object(
            organizer_service,
            "_stream_enabled",
            return_value=False,
        ):
            organizer_service.chat_one_round(messages, model="test-model")

        request_messages = create_mock.call_args.kwargs["messages"]
        self.assertEqual(request_messages[0], {"role": "system", "content": "system prompt"})
        self.assertEqual(request_messages[1]["role"], "assistant")
        self.assertNotIn("id", request_messages[1])
        self.assertNotIn("blocks", request_messages[1])
        self.assertIn("待确认请求", request_messages[1]["content"])
        self.assertIn("这是课程笔记", request_messages[1]["content"])

    def test_build_initial_messages_prioritizes_text_before_tool_call(self):
        messages = organizer_service.build_initial_messages("合同.pdf | 财务/合同 | 付款协议")

        self.assertNotIn("请先调用 submit_plan_diff", messages[1]["content"])

    def test_run_organizer_cycle_retries_with_full_assistant_message_for_invalid_plan_diff(self):
        initial_messages = [{"role": "user", "content": "请整理"}]
        first_message = SimpleNamespace(
            content="",
            tool_calls=[
                self._tool_call(
                    "submit_plan_diff",
                    '{"directory_renames": [], "move_updates": [{"source": "不存在.txt", "target": "Study/不存在.txt"}], "unresolved_adds": [], "unresolved_removals": [], "summary": "已更新"}',
                )
            ],
        )
        second_message = SimpleNamespace(content="第二轮说明", tool_calls=None)

        with mock.patch.object(
            organizer_service,
            "chat_one_round",
            side_effect=[first_message, second_message],
        ) as chat_mock:
            content, result = organizer_service.run_organizer_cycle(
                messages=list(initial_messages),
                scan_lines="合同.pdf | 财务/合同 | 付款协议",
                pending_plan=PendingPlan(),
                max_retries=2,
            )

        self.assertEqual(content, "第二轮说明")
        self.assertFalse(result["is_valid"])
        retry_messages = chat_mock.call_args_list[1].args[0]
        self.assertEqual(retry_messages[1]["role"], "assistant")
        self.assertEqual(retry_messages[1]["content"], "")
        self.assertEqual(retry_messages[1]["tool_calls"][0]["function"]["name"], "submit_plan_diff")
        self.assertEqual(retry_messages[2]["role"], "tool")
        self.assertEqual(retry_messages[2]["tool_call_id"], "call_1")
        self.assertIn("不存在的文件源", retry_messages[3]["content"])

    def test_chat_one_round_debug_log_records_chunk_and_synthetic_fields(self):
        chunk_1 = SimpleNamespace(
            choices=[SimpleNamespace(delta=SimpleNamespace(content="先说明", tool_calls=None), finish_reason=None)]
        )
        chunk_2 = SimpleNamespace(
            choices=[
                SimpleNamespace(
                    delta=SimpleNamespace(
                        content=None,
                        tool_calls=[
                            SimpleNamespace(
                                index=0,
                                id="call_1",
                                function=SimpleNamespace(
                                    name="submit_plan_diff",
                                    arguments='{"summary":"已分类 1 项"}',
                                ),
                            )
                        ],
                    ),
                    finish_reason="tool_calls",
                )
            ]
        )
        client = SimpleNamespace(
            chat=SimpleNamespace(
                completions=SimpleNamespace(create=mock.Mock(return_value=iter([chunk_1, chunk_2])))
            )
        )

        runtime_dir = Path("test_temp_debug_runtime")
        if runtime_dir.exists():
            shutil.rmtree(runtime_dir)
        runtime_dir.mkdir(parents=True, exist_ok=True)
        debug_log = runtime_dir / "debug_prompt.json"
        debug_jsonl = runtime_dir / "backend-debug.jsonl"
        try:
            with mock.patch.object(organizer_service, "create_openai_client", return_value=client), \
                 mock.patch("file_organizer.shared.config.RUNTIME_DIR", runtime_dir), \
                 mock.patch("file_organizer.shared.logging_utils.DEBUG_LOG_PATH", debug_jsonl), \
                 mock.patch(
                     "file_organizer.shared.config.config_manager.get",
                     side_effect=lambda key, default=None: True if key == "DEBUG_MODE" else default,
                 ):
                organizer_service.chat_one_round(
                    [{"role": "user", "content": "请整理"}],
                    return_message=True,
                )

            history = json.loads(debug_log.read_text(encoding="utf-8"))
            debug_lines = [json.loads(line) for line in debug_jsonl.read_text(encoding="utf-8").splitlines() if line.strip()]
        finally:
            if runtime_dir.exists():
                shutil.rmtree(runtime_dir)

        self.assertEqual(history[-1]["response"]["raw_content"], "先说明")
        self.assertEqual(history[-1]["response"]["display_content"], "先说明")
        self.assertFalse(history[-1]["response"]["synthetic_content_used"])
        self.assertEqual(history[-1]["response"]["chunks"][0]["delta_content"], "先说明")
        self.assertEqual(history[-1]["response"]["chunks"][1]["finish_reason"], "tool_calls")
        self.assertIn("organizer.request", [entry["kind"] for entry in debug_lines])
        self.assertIn("organizer.response", [entry["kind"] for entry in debug_lines])

    def test_chat_one_round_can_disable_stream_and_record_response_mode(self):
        response = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="先说明再操作。", tool_calls=[]), finish_reason="stop")],
            model_dump=lambda: {"id": "resp_123", "choices": [{"finish_reason": "stop"}]},
        )
        create_mock = mock.Mock(return_value=response)
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create_mock)))

        runtime_dir = Path("test_temp_debug_runtime")
        if runtime_dir.exists():
            shutil.rmtree(runtime_dir)
        runtime_dir.mkdir(parents=True, exist_ok=True)
        debug_log = runtime_dir / "debug_prompt.json"
        debug_jsonl = runtime_dir / "backend-debug.jsonl"
        try:
            with mock.patch.object(organizer_service, "create_openai_client", return_value=client), \
                 mock.patch("file_organizer.shared.config.RUNTIME_DIR", runtime_dir), \
                 mock.patch("file_organizer.shared.logging_utils.DEBUG_LOG_PATH", debug_jsonl), \
                 mock.patch(
                     "file_organizer.shared.config.config_manager.get",
                     side_effect=lambda key, default=None: True if key == "DEBUG_MODE" else default,
                 ), \
                 mock.patch.dict(os.environ, {"ORGANIZER_CHAT_STREAM": "false"}, clear=False):
                organizer_service.chat_one_round(
                    [{"role": "user", "content": "请整理"}],
                    return_message=True,
                )

            history = json.loads(debug_log.read_text(encoding="utf-8"))
            debug_lines = [json.loads(line) for line in debug_jsonl.read_text(encoding="utf-8").splitlines() if line.strip()]
        finally:
            if runtime_dir.exists():
                shutil.rmtree(runtime_dir)

        self.assertFalse(create_mock.call_args.kwargs["stream"])
        self.assertEqual(history[-1]["request_meta"]["stream"], False)
        self.assertEqual(history[-1]["response"]["response_mode"], "non_stream")
        self.assertEqual(history[-1]["response"]["raw_response"]["id"], "resp_123")
        self.assertIn("organizer.request", [entry["kind"] for entry in debug_lines])
        self.assertIn("organizer.response", [entry["kind"] for entry in debug_lines])


if __name__ == "__main__":
    unittest.main()
