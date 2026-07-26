import json
import os
import shutil
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from file_pilot.organize import service as organizer_service
from file_pilot.organize.models import FinalPlan, PendingPlan, PlanMove


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
        self.assertEqual(updated.summary, "已分类 1 项，待移动 2 项，待确认 1 项")
        self.assertTrue(any("Bills" in item for item in diff_summary))
        self.assertTrue(any("Screenshots/截图1.png" in item for item in diff_summary))

    def test_run_organizer_cycle_auto_displays_summary_after_diff_when_model_omits_present_tool(self):
        diff_call = SimpleNamespace(
            function=SimpleNamespace(
                name="submit_plan_diff",
                arguments='{"directory_renames": [], "move_updates": [{"source": "合同.pdf", "target": "Study/合同.pdf"}, {"source": "截图1.png", "target": "Review/截图1.png"}], "unresolved_adds": ["截图1.png"], "unresolved_removals": []}',
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
        self.assertEqual(result["display_plan"], {"focus": "summary", "summary": "已分类 1 项，待移动 2 项，待确认 1 项", "reason": ""})
        self.assertEqual(result["assistant_message"]["content"], organizer_service.SYNTHETIC_PLAN_REPLY)
        self.assertEqual(result["pending_plan"].directories, ["Review", "Study"])
        self.assertEqual(
            {move.source: move.target for move in result["pending_plan"].moves},
            {"合同.pdf": "Study/合同.pdf", "截图1.png": "Review/截图1.png"},
        )

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
        self.assertTrue(any("待确认区" in err for err in validation["path_errors"]))

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
                "reasoning_content": "先核对目录，再给出增量调整。",
                "blocks": [{"type": "unresolved_choices"}],
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
        self.assertEqual(
            request_messages[1],
            {
                "role": "assistant",
                "content": "",
                "reasoning_content": "先核对目录，再给出增量调整。",
            },
        )

    def test_chat_one_round_emits_wait_end_after_stream_finishes(self):
        chunk_1 = SimpleNamespace(
            choices=[SimpleNamespace(delta=SimpleNamespace(content="先说明", tool_calls=None), finish_reason=None)]
        )
        chunk_2 = SimpleNamespace(
            choices=[SimpleNamespace(delta=SimpleNamespace(content="再补充", tool_calls=None), finish_reason="stop")]
        )
        client = SimpleNamespace(
            chat=SimpleNamespace(
                completions=SimpleNamespace(create=mock.Mock(return_value=iter([chunk_1, chunk_2])))
            )
        )
        events = []

        with mock.patch.object(organizer_service, "create_openai_client", return_value=client):
            result = organizer_service.chat_one_round(
                [{"role": "user", "content": "请整理"}],
                event_handler=lambda event, data=None: events.append(event),
            )

        self.assertEqual(result, "先说明再补充")
        self.assertIn("ai_streaming_end", events)
        self.assertIn("model_wait_end", events)
        self.assertGreater(events.index("model_wait_end"), events.index("ai_streaming_end"))

    def test_chat_one_round_closes_stream_when_timeout_happens(self):
        class SlowStream:
            def __init__(self):
                self.closed = False

            def __iter__(self):
                yield SimpleNamespace(
                    choices=[SimpleNamespace(delta=SimpleNamespace(content="片段", tool_calls=None), finish_reason=None)]
                )

            def close(self):
                self.closed = True

        stream = SlowStream()
        client = SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=mock.Mock(return_value=stream)))
        )
        events = []
        monotonic_values = iter([0.0, 999.0])

        with mock.patch.object(organizer_service, "create_openai_client", return_value=client), mock.patch.object(
            organizer_service,
            "get_text_stream_max_seconds",
            return_value=1,
        ), mock.patch.object(
            organizer_service.time,
            "monotonic",
            side_effect=lambda: next(monotonic_values),
        ):
            with self.assertRaises(TimeoutError):
                organizer_service.chat_one_round(
                    [{"role": "user", "content": "请整理"}],
                    event_handler=lambda event, data=None: events.append(event),
                )

        self.assertTrue(stream.closed)
        self.assertIn("model_wait_end", events)

    def test_chat_one_round_closes_stream_when_cancelled(self):
        cancel_event = threading.Event()

        class CancelAwareStream:
            def __init__(self):
                self.closed = False

            def __iter__(self):
                cancel_event.set()
                yield SimpleNamespace(
                    choices=[SimpleNamespace(delta=SimpleNamespace(content="片段", tool_calls=None), finish_reason=None)]
                )

            def close(self):
                self.closed = True

        stream = CancelAwareStream()
        client = SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=mock.Mock(return_value=stream)))
        )
        events = []

        with mock.patch.object(organizer_service, "create_openai_client", return_value=client):
            with self.assertRaisesRegex(RuntimeError, organizer_service.PLANNING_CANCELLED_ERROR):
                organizer_service.chat_one_round(
                    [{"role": "user", "content": "请整理"}],
                    event_handler=lambda event, data=None: events.append(event),
                    cancel_event=cancel_event,
                )

        self.assertTrue(stream.closed)
        self.assertIn("model_wait_end", events)

    def test_chat_one_round_reads_runtime_model_when_not_explicitly_passed(self):
        response = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="好的", tool_calls=[]))]
        )
        create_mock = mock.Mock(return_value=response)
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create_mock)))

        with mock.patch.object(organizer_service, "create_openai_client", return_value=client), mock.patch.object(
            organizer_service,
            "get_organizer_model_name",
            return_value="glm-4.7",
        ), mock.patch.object(
            organizer_service,
            "_stream_enabled",
            return_value=False,
        ):
            organizer_service.chat_one_round([{"role": "user", "content": "请整理"}])

        self.assertEqual(create_mock.call_args.kwargs["model"], "glm-4.7")

    def test_build_initial_messages_prioritizes_text_before_tool_call(self):
        messages = organizer_service.build_initial_messages("合同.pdf | 财务/合同 | 付款协议")

        self.assertNotIn("请先调用 submit_plan_diff", messages[1]["content"])

    def test_build_initial_messages_with_planner_items_includes_real_name_context_but_keeps_item_id_as_key(self):
        messages = organizer_service.build_initial_messages(
            "very_long_real_filename_contract_v12_final_really_final.pdf | 财务合同 | 付款协议",
            planner_items=[
                {
                    "planner_id": "F001",
                    "source_relpath": "very_long_real_filename_contract_v12_final_really_final.pdf",
                    "display_name": "very_long_real_filename_contract_v12_final_really_final.pdf",
                    "entry_type": "file",
                    "suggested_purpose": "财务合同",
                    "summary": "付款协议",
                    "ext": "pdf",
                    "parent_hint": "",
                }
            ],
        )

        self.assertIn(
            "F001 | file | very_long_real_filename_contract_v12_final_really_final.pdf | 财务合同 | 付款协议",
            messages[0]["content"],
        )
        self.assertIn("`item_id` 是唯一操作键", messages[0]["content"])

    def test_render_planner_scan_lines_preserves_entry_type_for_dir_and_suffixless_file(self):
        rendered = organizer_service.render_planner_scan_lines(
            [
                {
                    "planner_id": "F001",
                    "source_relpath": "project.v1",
                    "display_name": "project.v1",
                    "entry_type": "dir",
                    "suggested_purpose": "项目目录",
                    "summary": "目录入口",
                    "ext": "item",
                },
                {
                    "planner_id": "F002",
                    "source_relpath": "README",
                    "display_name": "README",
                    "entry_type": "file",
                    "suggested_purpose": "说明文件",
                    "summary": "无后缀文本",
                    "ext": "item",
                },
            ]
        )

        self.assertIn("F001 | dir | project.v1 | 项目目录 | 目录入口", rendered)
        self.assertIn("F002 | file | README | 说明文件 | 无后缀文本", rendered)

    def test_apply_plan_diff_rejects_incremental_directory_rename_and_unselected_existing_root(self):
        old_plan = PendingPlan(
            moves=[PlanMove(source="合同.pdf", target="合同.pdf")],
            unresolved_items=[],
        )
        diff = {
            "directory_renames": [{"from": "Docs", "to": "Archive"}],
            "move_updates": [{"source": "合同.pdf", "target": "D:/existing/Study/合同.pdf"}],
            "unresolved_adds": [],
            "unresolved_removals": [],
        }

        _, _, errors = organizer_service.apply_plan_diff(
            old_plan,
            diff,
            valid_sources=["合同.pdf"],
            planning_context={
                "organize_mode": "incremental",
                "target_directories": ["D:/existing/Finance"],
                "root_directory_options": ["D:/existing/Finance", "D:/existing/Study"],
            },
        )

        self.assertTrue(any("禁止目录改名" in error for error in errors))
        self.assertTrue(any("不在允许范围内" in error for error in errors))

    def test_validate_final_plan_allows_new_top_level_but_rejects_unselected_existing_root(self):
        final_plan = FinalPlan(
            directories=["NewDir"],
            moves=[PlanMove(source="合同.pdf", target="NewDir/合同.pdf")],
            unresolved_items=[],
        )

        validation = organizer_service.validate_final_plan(
            "合同.pdf | 财务/合同 | 付款协议",
            final_plan,
            planning_context={
                "organize_mode": "incremental",
                "target_directories": ["D:/existing/Finance"],
                "root_directory_options": ["D:/existing/Finance", "D:/existing/Study"],
            },
        )

        self.assertTrue(validation["is_valid"])

        blocked_validation = organizer_service.validate_final_plan(
            "合同.pdf | 财务/合同 | 付款协议",
            FinalPlan(
                directories=[],
                moves=[PlanMove(source="合同.pdf", target="D:/existing/Study/合同.pdf")],
                unresolved_items=[],
            ),
            planning_context={
                "organize_mode": "incremental",
                "target_directories": ["D:/existing/Finance"],
                "root_directory_options": ["D:/existing/Finance", "D:/existing/Study"],
            },
        )

        self.assertFalse(blocked_validation["is_valid"])
        self.assertTrue(any("不在允许范围内" in error for error in blocked_validation["mode_errors"]))

    def test_run_organizer_cycle_translates_planner_ids_back_to_real_sources(self):
        diff_call = SimpleNamespace(
            function=SimpleNamespace(
                name="submit_plan_diff",
                arguments='{"directory_renames": [], "move_updates": [{"item_id": "F001", "target_dir": "Study"}], "unresolved_adds": ["F001"], "unresolved_removals": []}',
            )
        )
        message = SimpleNamespace(content="", tool_calls=[diff_call])

        with mock.patch.object(organizer_service, "chat_one_round", return_value=message):
            _, result = organizer_service.run_organizer_cycle(
                messages=[],
                scan_lines="very_long_real_filename_contract_v12_final_really_final.pdf | 财务合同 | 付款协议",
                planner_items=[
                    {
                        "planner_id": "F001",
                        "source_relpath": "very_long_real_filename_contract_v12_final_really_final.pdf",
                        "display_name": "very_long_real_filename_contract_v12_final_really_final.pdf",
                        "suggested_purpose": "财务合同",
                        "summary": "付款协议",
                        "ext": "pdf",
                        "parent_hint": "",
                    }
                ],
                pending_plan=PendingPlan(),
            )

        self.assertEqual(
            result["pending_plan"].moves[0].source,
            "very_long_real_filename_contract_v12_final_really_final.pdf",
        )
        self.assertEqual(
            result["pending_plan"].moves[0].target,
            "Study/very_long_real_filename_contract_v12_final_really_final.pdf",
        )

    def test_run_organizer_cycle_accepts_target_slot_and_translates_to_real_directory(self):
        diff_call = SimpleNamespace(
            function=SimpleNamespace(
                name="submit_plan_diff",
                arguments='{"directory_renames": [], "move_updates": [{"item_id": "F001", "target_slot": "D001"}], "unresolved_adds": [], "unresolved_removals": []}',
            )
        )
        message = SimpleNamespace(content="", tool_calls=[diff_call])

        with mock.patch.object(organizer_service, "chat_one_round", return_value=message):
            _, result = organizer_service.run_organizer_cycle(
                messages=[],
                scan_lines="contract.pdf | 财务合同 | 付款协议",
                planner_items=[
                    {
                        "planner_id": "F001",
                        "source_relpath": "contract.pdf",
                        "display_name": "contract.pdf",
                        "suggested_purpose": "财务合同",
                        "summary": "付款协议",
                        "ext": "pdf",
                        "parent_hint": "",
                    }
                ],
                pending_plan=PendingPlan(),
                planning_context={
                    "organize_mode": "incremental",
                    "target_directories": ["Finance"],
                    "root_directory_options": ["Finance", "Study"],
                    "target_slots": [
                        {"slot_id": "D001", "display_name": "合同", "relpath": "Finance/合同", "depth": 1, "is_new": False}
                    ],
                },
            )

        self.assertEqual(result["pending_plan"].moves[0].source, "contract.pdf")
        self.assertEqual(result["pending_plan"].moves[0].target, "Finance/合同/contract.pdf")

    def test_run_organizer_cycle_falls_back_to_slot_real_path_when_relpath_is_missing(self):
        diff_call = SimpleNamespace(
            function=SimpleNamespace(
                name="submit_plan_diff",
                arguments='{"directory_renames": [], "move_updates": [{"item_id": "F001", "target_slot": "D031"}], "unresolved_adds": [], "unresolved_removals": []}',
            )
        )
        message = SimpleNamespace(content="", tool_calls=[diff_call])

        with mock.patch.object(organizer_service, "chat_one_round", return_value=message):
            _, result = organizer_service.run_organizer_cycle(
                messages=[],
                scan_lines="contract.pdf | 财务合同 | 付款协议",
                planner_items=[
                    {
                        "planner_id": "F001",
                        "source_relpath": "contract.pdf",
                        "display_name": "contract.pdf",
                        "suggested_purpose": "财务合同",
                        "summary": "付款协议",
                        "ext": "pdf",
                        "parent_hint": "",
                    }
                ],
                pending_plan=PendingPlan(),
                planning_context={
                    "organize_mode": "incremental",
                    "target_directories": ["D:/archive/docs"],
                    "root_directory_options": ["D:/archive/docs", "D:/archive/media"],
                    "target_slots": [
                        {
                            "slot_id": "D031",
                            "display_name": "项目文档",
                            "relpath": "",
                            "real_path": "D:/archive/docs/项目文档",
                            "depth": 1,
                            "is_new": False,
                        }
                    ],
                },
            )

        self.assertEqual(result["pending_plan"].moves[0].target, "D:/archive/docs/项目文档/contract.pdf")

    def test_build_prompt_includes_target_slot_inventory_for_incremental_mode(self):
        prompt = organizer_service.build_prompt(
            "F001 | file | contract.pdf | contract.pdf | 财务合同 | 付款协议",
            planning_context={
                "organize_mode": "incremental",
                "target_directories": ["Finance"],
                "root_directory_options": ["Finance", "Study"],
                "target_slots": [
                    {"slot_id": "D001", "display_name": "合同", "relpath": "Finance/合同", "depth": 1, "is_new": False},
                    {"slot_id": "D999", "display_name": "待确认区", "relpath": "Review", "depth": 0, "is_new": False, "kind": "review"},
                ],
            },
        )

        self.assertIn("可用目标槽位", prompt)
        self.assertIn("D001 -> Finance/合同", prompt)
        self.assertNotIn("D999", prompt)
        self.assertNotIn("D999 -> Review", prompt)
        self.assertIn("优先使用 `target_slot`", prompt)

    def test_run_organizer_cycle_translates_review_kind_target_slot_to_pending_area(self):
        diff_call = SimpleNamespace(
            function=SimpleNamespace(
                name="submit_plan_diff",
                arguments='{"directory_renames": [], "move_updates": [{"item_id": "F001", "target_slot": "D999"}], "unresolved_adds": [], "unresolved_removals": []}',
            )
        )
        message = SimpleNamespace(content="", tool_calls=[diff_call])

        with mock.patch.object(organizer_service, "chat_one_round", return_value=message):
            _, result = organizer_service.run_organizer_cycle(
                messages=[],
                scan_lines="contract.pdf | 财务合同 | 付款协议",
                planner_items=[
                    {
                        "planner_id": "F001",
                        "source_relpath": "contract.pdf",
                        "display_name": "contract.pdf",
                        "suggested_purpose": "财务合同",
                        "summary": "付款协议",
                        "ext": "pdf",
                        "parent_hint": "",
                    }
                ],
                pending_plan=PendingPlan(),
                planning_context={
                    "organize_mode": "incremental",
                    "target_directories": ["Finance"],
                    "root_directory_options": ["Finance", "Study"],
                    "target_slots": [
                        {"slot_id": "D001", "display_name": "合同", "relpath": "Finance/合同", "depth": 1, "is_new": False},
                        {"slot_id": "D999", "display_name": "待确认区", "relpath": "Review", "depth": 0, "is_new": False, "kind": "review"},
                    ],
                },
            )

        self.assertEqual(result["pending_plan"].moves[0].source, "contract.pdf")
        self.assertEqual(result["pending_plan"].moves[0].target, "Review/contract.pdf")

    def test_run_organizer_cycle_does_not_leak_planner_ids_into_pending_unresolved_items(self):
        diff_call = self._tool_call(
            "submit_plan_diff",
            '{"directory_renames": [], "move_updates": [{"item_id": "F001", "target_dir": "Review"}], "unresolved_adds": ["F001"], "unresolved_removals": []}',
            tool_id="call_diff",
        )
        message = SimpleNamespace(content="这份文件需要你确认归类。", tool_calls=[diff_call])

        with mock.patch.object(organizer_service, "chat_one_round", return_value=message):
            _, result = organizer_service.run_organizer_cycle(
                messages=[],
                scan_lines="very_long_real_filename_contract_v12_final_really_final.pdf | 财务合同 | 付款协议",
                planner_items=[
                    {
                        "planner_id": "F001",
                        "source_relpath": "very_long_real_filename_contract_v12_final_really_final.pdf",
                        "display_name": "very_long_real_filename_contract_v12_final_really_final.pdf",
                        "suggested_purpose": "财务合同",
                        "summary": "付款协议",
                        "ext": "pdf",
                        "parent_hint": "",
                    }
                ],
                pending_plan=PendingPlan(),
            )

        pending = result["pending_plan"]
        self.assertEqual(
            [move.source for move in pending.moves],
            ["very_long_real_filename_contract_v12_final_really_final.pdf"],
        )
        self.assertEqual(
            pending.moves[0].target,
            "Review/very_long_real_filename_contract_v12_final_really_final.pdf",
        )
        self.assertEqual(
            pending.unresolved_items,
            ["very_long_real_filename_contract_v12_final_really_final.pdf"],
        )

    def test_build_organizer_tools_only_exposes_plan_diff_in_default_mode(self):
        tools = organizer_service.build_organizer_tools()

        self.assertEqual(
            [tool["function"]["name"] for tool in tools],
            ["submit_plan_diff", "inspect_entry_content"],
        )

    def test_build_organizer_tools_description_uses_field_based_protocol(self):
        tool = organizer_service.build_organizer_tools()[0]
        description = tool["function"]["description"]

        self.assertIn("字段含义", description)
        self.assertIn("directory_renames=目录改名", description)
        self.assertIn("unresolved_adds=新增待确认条目", description)
        self.assertIn("target_dir 只写相对新目录生成位置的目录路径", description)
        self.assertIn("拿不准的条目只加入 unresolved_adds", description)
        self.assertIn("不要再为该项提交 move_updates", description)

    def test_build_organizer_tools_exposes_inspect_entry_content_with_usage_guardrails(self):
        tool = organizer_service.build_organizer_tools()[1]

        self.assertEqual(tool["function"]["name"], "inspect_entry_content")
        self.assertIn("summary 不足", tool["function"]["description"])
        self.assertIn("不要批量查看全部条目", tool["function"]["description"])

    def test_run_organizer_cycle_inspects_entry_content_before_submitting_plan_diff(self):
        inspect_message = SimpleNamespace(
            content="我先查看这个文件的具体内容。",
            tool_calls=[
                self._tool_call(
                    "inspect_entry_content",
                    '{"item_ids": ["F001"]}',
                    tool_id="call_inspect",
                )
            ],
        )
        diff_message = SimpleNamespace(
            content="这份文件更适合归到财务资料。",
            tool_calls=[
                self._tool_call(
                    "submit_plan_diff",
                    '{"directory_renames": [], "move_updates": [{"item_id": "F001", "target_dir": "Finance"}], "unresolved_adds": [], "unresolved_removals": []}',
                    tool_id="call_diff",
                )
            ],
        )

        with mock.patch.object(
            organizer_service,
            "chat_one_round",
            side_effect=[inspect_message, diff_message],
        ) as chat_mock, mock.patch.object(
            organizer_service,
            "read_local_file",
            return_value="--- 文件 [D:/docs/contract.pdf] 内容开始 ---\n合同正文内容\n--- 内容结束 ---",
        ):
            _, result = organizer_service.run_organizer_cycle(
                messages=[],
                scan_lines="contract.pdf | 财务合同 | 付款协议",
                planner_items=[
                    {
                        "planner_id": "F001",
                        "source_relpath": "contract.pdf",
                        "display_name": "contract.pdf",
                        "entry_type": "file",
                        "suggested_purpose": "财务合同",
                        "summary": "付款协议",
                    }
                ],
                pending_plan=PendingPlan(),
                planning_context={
                    "inspection_context": {
                        "F001": {
                            "item_id": "F001",
                            "source_relpath": "contract.pdf",
                            "display_name": "contract.pdf",
                            "entry_type": "file",
                            "absolute_path": "D:/docs/contract.pdf",
                            "allowed_base_dir": "D:/docs",
                        }
                    }
                },
            )

        self.assertEqual(result["pending_plan"].moves[0].target, "Finance/contract.pdf")
        replay_messages = chat_mock.call_args_list[1].args[0]
        self.assertEqual(replay_messages[-1]["role"], "tool")
        self.assertIn("合同正文内容", replay_messages[-1]["content"])
        persisted_messages = result["assistant_context_messages"]
        self.assertEqual(persisted_messages[0]["visibility"], "internal")
        self.assertEqual(persisted_messages[1]["name"], "inspect_entry_content")
        self.assertIn("已查看详细内容", persisted_messages[1]["content"])
        self.assertNotIn("合同正文内容", persisted_messages[1]["content"])

    def test_run_organizer_cycle_returns_structured_error_for_unknown_inspection_item(self):
        inspect_message = SimpleNamespace(
            content="我先确认一下条目内容。",
            tool_calls=[self._tool_call("inspect_entry_content", '{"item_ids": ["F404"]}', tool_id="call_inspect")],
        )
        plain_message = SimpleNamespace(content="我无法读取这个条目，请你确认后重试。", tool_calls=None)

        with mock.patch.object(
            organizer_service,
            "chat_one_round",
            side_effect=[inspect_message, plain_message],
        ) as chat_mock:
            content, result = organizer_service.run_organizer_cycle(
                messages=[],
                scan_lines="contract.pdf | 财务合同 | 付款协议",
                planner_items=[],
                pending_plan=PendingPlan(),
                planning_context={"inspection_context": {}},
            )

        self.assertEqual(content, "我无法读取这个条目，请你确认后重试。")
        self.assertFalse(result["is_valid"])
        self.assertIn("ITEM_NOT_FOUND", chat_mock.call_args_list[1].args[0][-1]["content"])

    def test_run_organizer_cycle_prioritizes_inspection_over_same_round_plan_submission(self):
        mixed_message = SimpleNamespace(
            content="我先看一下内容，再决定去向。",
            tool_calls=[
                self._tool_call("inspect_entry_content", '{"item_ids": ["F001"]}', tool_id="call_inspect"),
                self._tool_call(
                    "submit_plan_diff",
                    '{"directory_renames": [], "move_updates": [{"item_id": "F001", "target_dir": "Study"}], "unresolved_adds": [], "unresolved_removals": []}',
                    tool_id="call_diff",
                ),
            ],
        )
        final_message = SimpleNamespace(
            content="看过内容后，这份文件还是放财务资料更合适。",
            tool_calls=[
                self._tool_call(
                    "submit_plan_diff",
                    '{"directory_renames": [], "move_updates": [{"item_id": "F001", "target_dir": "Finance"}], "unresolved_adds": [], "unresolved_removals": []}',
                    tool_id="call_diff_2",
                )
            ],
        )

        with mock.patch.object(
            organizer_service,
            "chat_one_round",
            side_effect=[mixed_message, final_message],
        ), mock.patch.object(
            organizer_service,
            "read_local_file",
            return_value="--- 文件 [D:/docs/contract.pdf] 内容开始 ---\n合同正文内容\n--- 内容结束 ---",
        ):
            _, result = organizer_service.run_organizer_cycle(
                messages=[],
                scan_lines="contract.pdf | 财务合同 | 付款协议",
                planner_items=[
                    {
                        "planner_id": "F001",
                        "source_relpath": "contract.pdf",
                        "display_name": "contract.pdf",
                        "entry_type": "file",
                        "suggested_purpose": "财务合同",
                        "summary": "付款协议",
                    }
                ],
                pending_plan=PendingPlan(),
                planning_context={
                    "inspection_context": {
                        "F001": {
                            "item_id": "F001",
                            "source_relpath": "contract.pdf",
                            "display_name": "contract.pdf",
                            "entry_type": "file",
                            "absolute_path": "D:/docs/contract.pdf",
                            "allowed_base_dir": "D:/docs",
                        }
                    }
                },
            )

        self.assertEqual(result["pending_plan"].moves[0].target, "Finance/contract.pdf")

    def test_build_organizer_tools_description_for_incremental_mode_forbids_new_targets(self):
        tool = organizer_service.build_organizer_tools(
            {
                "organize_mode": "incremental",
                "target_directories": ["Finance"],
                "target_slots": [{"slot_id": "D001", "relpath": "Finance", "depth": 0}],
            }
        )[0]
        description = tool["function"]["description"]

        self.assertIn("不能创建新目标目录", description)
        self.assertIn("target_dir 必须精确等于某个已选目标目录", description)
        self.assertIn("系统会自动放入待确认区", description)
        self.assertNotIn("或放入 Review", description)

    def test_build_organizer_tools_filters_review_slots_from_incremental_description(self):
        tool = organizer_service.build_organizer_tools(
            {
                "organize_mode": "incremental",
                "target_directories": ["Finance"],
                "target_slots": [
                    {"slot_id": "D001", "relpath": "Finance", "depth": 0},
                    {"slot_id": "D999", "relpath": "Review", "display_name": "待确认区", "kind": "review"},
                ],
            }
        )[0]

        description = tool["function"]["description"]

        self.assertIn("D001=Finance", description)
        self.assertNotIn("D999", description)

    def test_retry_and_repair_prompts_keep_review_as_internal_pending_area(self):
        validation = {
            "missing": [],
            "extra": [],
            "duplicates": [],
            "order_errors": [],
            "invalid_lines": [],
            "path_errors": [],
            "rename_errors": [],
            "duplicate_mkdirs": [],
            "missing_mkdirs": [],
            "unused_mkdirs": [],
            "conflicting_targets": [],
        }
        planning_context = {
            "organize_mode": "incremental",
            "target_directories": ["Finance"],
            "target_directory_details": [
                {
                    "path": "Finance",
                    "label": "财务目录",
                    "description": "适合发票、报销单和合同",
                }
            ],
            "target_slots": [{"slot_id": "D001", "relpath": "Finance", "depth": 0}],
        }

        retry = organizer_service.build_command_retry_message(
            validation,
            planner_items=[],
            planning_context=planning_context,
        )
        repair = organizer_service._build_repair_messages(
            "F001 | file | 合同.pdf | 财务合同 | 付款协议",
            [],
            validation,
            planner_items=[],
            planning_context=planning_context,
        )[-1]["content"]

        self.assertIn("或交给系统放入待确认区", retry)
        self.assertIn("或交给系统放入待确认区", repair)
        self.assertIn("Finance（标签：财务目录；说明：适合发票、报销单和合同）", retry)
        self.assertIn("Finance（标签：财务目录；说明：适合发票、报销单和合同）", repair)
        self.assertNotIn("或放入 Review", retry)
        self.assertNotIn("或放入 Review", repair)

    def test_run_organizer_cycle_retries_with_full_assistant_message_for_invalid_plan_diff(self):
        initial_messages = [{"role": "user", "content": "请整理"}]
        first_message = SimpleNamespace(
            content="",
            reasoning_content="先检查 source 是否仍在当前规划范围内。",
            tool_calls=[
                self._tool_call(
                    "submit_plan_diff",
                    '{"directory_renames": [], "move_updates": [{"source": "不存在.txt", "target": "Study/不存在.txt"}], "unresolved_adds": [], "unresolved_removals": []}',
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
        self.assertEqual(retry_messages[1]["reasoning_content"], "先检查 source 是否仍在当前规划范围内。")
        self.assertEqual(retry_messages[1]["tool_calls"][0]["function"]["name"], "submit_plan_diff")
        self.assertEqual(retry_messages[2]["role"], "tool")
        self.assertEqual(retry_messages[2]["tool_call_id"], "call_1")
        self.assertIn("不存在的源文件或目录", retry_messages[3]["content"])

    def test_chat_one_round_keeps_reasoning_content_for_non_stream_response(self):
        response = SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content="先说明再操作。",
                        reasoning_content="先确认现有目录结构，再生成增量方案。",
                        tool_calls=[],
                    ),
                    finish_reason="stop",
                )
            ],
            model_dump=lambda: {"id": "resp_reasoning"},
        )
        create_mock = mock.Mock(return_value=response)
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create_mock)))

        with mock.patch.object(organizer_service, "create_openai_client", return_value=client):
            message = organizer_service.chat_one_round(
                [{"role": "user", "content": "请整理"}],
                return_message=True,
            )

        self.assertEqual(message.content, "先说明再操作。")
        self.assertEqual(message.reasoning_content, "先确认现有目录结构，再生成增量方案。")

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
                                    arguments='{"directory_renames":[],"move_updates":[],"unresolved_adds":[],"unresolved_removals":[]}',
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
                 mock.patch("file_pilot.shared.config.RUNTIME_DIR", runtime_dir), \
                 mock.patch("file_pilot.shared.logging_utils.DEBUG_LOG_PATH", debug_jsonl), \
                 mock.patch(
                     "file_pilot.shared.config.config_manager.get",
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
                 mock.patch("file_pilot.shared.config.RUNTIME_DIR", runtime_dir), \
                 mock.patch("file_pilot.shared.logging_utils.DEBUG_LOG_PATH", debug_jsonl), \
                 mock.patch(
                     "file_pilot.shared.config.config_manager.get",
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

    def test_chat_one_round_accepts_plain_text_string_response_even_when_stream_enabled(self):
        create_mock = mock.Mock(return_value="先讨论整理方案。")
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create_mock)))
        events = []

        with mock.patch.object(organizer_service, "create_openai_client", return_value=client):
            result = organizer_service.chat_one_round(
                [{"role": "user", "content": "请整理"}],
                event_handler=lambda event, data=None: events.append(event),
            )

        self.assertEqual(result, "先讨论整理方案。")
        self.assertEqual(events[:3], ["model_wait_start", "model_wait_end", "ai_streaming_start"])
        self.assertIn("ai_streaming_end", events)
        self.assertTrue(create_mock.call_args.kwargs["stream"])

    def test_chat_one_round_accepts_json_string_tool_calls(self):
        response = json.dumps(
            {
                "choices": [
                    {
                        "message": {
                            "content": "",
                            "tool_calls": [
                                {
                                    "id": "call_1",
                                    "type": "function",
                                    "function": {
                                        "name": "submit_plan_diff",
                                        "arguments": '{"directory_renames":[],"move_updates":[],"unresolved_adds":[],"unresolved_removals":[]}',
                                    },
                                }
                            ],
                        },
                        "finish_reason": "tool_calls",
                    }
                ]
            },
            ensure_ascii=False,
        )
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=mock.Mock(return_value=response))))

        with mock.patch.object(organizer_service, "create_openai_client", return_value=client):
            message = organizer_service.chat_one_round(
                [{"role": "user", "content": "请整理"}],
                return_message=True,
            )

        self.assertEqual(message.content, "")
        self.assertEqual(message.tool_calls[0].function.name, "submit_plan_diff")
        self.assertIn('"move_updates":[]', message.tool_calls[0].function.arguments)


if __name__ == "__main__":
    unittest.main()
