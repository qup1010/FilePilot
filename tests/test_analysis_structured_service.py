import shutil
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from file_pilot.analysis import service as analysis_service
from file_pilot.analysis.models import AnalysisItem


class StructuredAnalysisServiceTests(unittest.TestCase):
    def setUp(self):
        self.base_dir = Path("test_temp_analysis_structured")
        if self.base_dir.exists():
            shutil.rmtree(self.base_dir)
        self.base_dir.mkdir()
        (self.base_dir / "合同.pdf").write_text("demo", encoding="utf-8")
        (self.base_dir / "Screenshots").mkdir()

    def tearDown(self):
        if self.base_dir.exists():
            shutil.rmtree(self.base_dir)

    def test_render_analysis_items_includes_entry_type_in_scan_format(self):
        items = [
            AnalysisItem(
                entry_name="合同.pdf",
                entry_type="file",
                suggested_purpose="财务/合同",
                summary="付款协议",
                evidence_sources=["filename", "pdf_text"],
                confidence=0.92,
            )
        ]

        rendered = analysis_service.render_analysis_items(items)

        self.assertIn("合同.pdf | file | 财务/合同 | 付款协议", rendered)
        self.assertNotIn("confidence", rendered)

    def test_validate_analysis_items_accepts_current_level_entries(self):
        items = [
            AnalysisItem(
                entry_name="合同.pdf",
                entry_type="file",
                suggested_purpose="财务/合同",
                summary="付款协议",
                evidence_sources=["filename"],
                confidence=0.9,
            ),
            AnalysisItem(
                entry_name="Screenshots",
                entry_type="dir",
                suggested_purpose="截图记录",
                summary="软件报错截图",
                evidence_sources=["directory_listing"],
                confidence=0.7,
            ),
        ]

        validation = analysis_service.validate_analysis_items(items, self.base_dir)

        self.assertTrue(validation["is_valid"])
        self.assertEqual(validation["missing"], [])
        self.assertEqual(validation["extra"], [])

    def test_validate_analysis_items_normalizes_relative_and_absolute_entry_names(self):
        items = [
            AnalysisItem(entry_name="./合同.pdf", suggested_purpose="财务/合同", summary="付款协议"),
            AnalysisItem(
                entry_name=str((self.base_dir / "Screenshots").resolve()),
                suggested_purpose="截图记录",
                summary="软件报错截图",
            ),
        ]

        validation = analysis_service.validate_analysis_items(items, self.base_dir)

        self.assertTrue(validation["is_valid"])
        self.assertEqual(validation["missing"], [])
        self.assertEqual(validation["extra"], [])

    def test_append_output_result_accepts_structured_items(self):
        items = [
            AnalysisItem(
                entry_name="合同.pdf",
                entry_type="file",
                suggested_purpose="财务/合同",
                summary="付款协议",
                evidence_sources=["filename"],
                confidence=0.9,
            )
        ]
        result_file = self.base_dir / "result.txt"

        with mock.patch.object(analysis_service, "RESULT_FILE_PATH", result_file):
            saved_path = analysis_service.append_output_result(items)

        self.assertEqual(saved_path, result_file)
        self.assertIn("合同.pdf | file | 财务/合同 | 付款协议", result_file.read_text(encoding="utf-8"))

    def test_run_analysis_cycle_emits_wait_events_around_model_request(self):
        submitted_items = [
            AnalysisItem(
                entry_name="合同.pdf",
                entry_type="file",
                suggested_purpose="财务/合同",
                summary="付款协议",
                evidence_sources=["filename"],
                confidence=0.9,
            ),
            AnalysisItem(
                entry_name="Screenshots",
                entry_type="dir",
                suggested_purpose="截图记录",
                summary="软件报错截图",
                evidence_sources=["directory_listing"],
                confidence=0.7,
            ),
        ]
        tool_call = SimpleNamespace(
            function=SimpleNamespace(
                name=analysis_service.SUBMIT_ANALYSIS_TOOL_NAME,
                arguments='{"items": [{"entry_id": "F002", "entry_type": "file", "suggested_purpose": "财务/合同", "summary": "付款协议", "evidence_sources": ["filename"], "confidence": 0.9}, {"entry_id": "F001", "entry_type": "dir", "suggested_purpose": "截图记录", "summary": "软件报错截图", "evidence_sources": ["directory_listing"], "confidence": 0.7}]}'
            )
        )
        response = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(tool_calls=[tool_call], content=""))]
        )
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=mock.Mock(return_value=response))))
        events = []

        with mock.patch.object(analysis_service, "get_client", return_value=client), mock.patch.object(
            analysis_service, "list_local_files", return_value="示例文件列表"
        ):
            rendered = analysis_service.run_analysis_cycle(self.base_dir, event_handler=lambda event, data=None: events.append(event))

        self.assertEqual(rendered, analysis_service.render_analysis_items(submitted_items))
        self.assertIn("model_wait_start", events)
        self.assertIn("model_wait_end", events)
        self.assertLess(events.index("model_wait_start"), events.index("model_wait_end"))

    def test_run_analysis_cycle_emits_api_retry_for_retryable_model_error(self):
        class RetryableApiError(Exception):
            status_code = 504
            body = {"retry_after": 120}

        tool_call = SimpleNamespace(
            function=SimpleNamespace(
                name=analysis_service.SUBMIT_ANALYSIS_TOOL_NAME,
                arguments='{"items": [{"entry_id": "F002", "entry_type": "file", "suggested_purpose": "财务/合同", "summary": "付款协议"}, {"entry_id": "F001", "entry_type": "dir", "suggested_purpose": "截图记录", "summary": "软件报错截图"}]}'
            )
        )
        response = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(tool_calls=[tool_call], content=""))]
        )
        create_mock = mock.Mock(side_effect=[RetryableApiError("Gateway Timeout"), response])
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create_mock)))
        events = []

        with mock.patch.object(analysis_service, "get_client", return_value=client), mock.patch.object(
            analysis_service, "list_local_files", return_value="示例文件列表"
        ), mock.patch.object(analysis_service.time, "sleep"):
            analysis_service.run_analysis_cycle(
                self.base_dir,
                event_handler=lambda event, data=None: events.append((event, data or {})),
            )

        retry_events = [data for event, data in events if event == "api_retry"]
        self.assertEqual(len(retry_events), 1)
        self.assertEqual(retry_events[0]["summary"], "模型服务网关超时")
        self.assertEqual(retry_events[0]["retry_after_seconds"], 120)
        self.assertEqual(create_mock.call_count, 2)

    def test_run_analysis_cycle_aborts_retry_when_failed_entries_ratio_is_too_high(self):
        entries = [f"entry_{index:03d}.txt" for index in range(40)]
        events = []

        with mock.patch.object(analysis_service, "_list_current_entries", return_value=entries), mock.patch.object(
            analysis_service,
            "_analyze_batch",
            side_effect=RuntimeError("mock batch failed"),
        ), mock.patch.object(
            analysis_service,
            "get_scan_failed_retry_abort_ratio",
            return_value=0.5,
        ):
            with self.assertRaisesRegex(RuntimeError, "失败批次过多"):
                analysis_service.run_analysis_cycle(
                    self.base_dir,
                    event_handler=lambda event, data=None: events.append((event, data or {})),
                )

        batch_events = [data for event, data in events if event == "batch_progress"]
        self.assertTrue(any(item.get("status") == "failed_too_many" for item in batch_events))

    def test_run_analysis_cycle_stops_immediately_when_cancelled(self):
        cancel_event = threading.Event()
        cancel_event.set()

        with self.assertRaisesRegex(RuntimeError, analysis_service.SCAN_CANCELLED_ERROR), mock.patch.object(
            analysis_service,
            "get_client",
        ) as client_mock:
            analysis_service.run_analysis_cycle(self.base_dir, cancel_event=cancel_event)

        client_mock.assert_not_called()

    def test_run_analysis_cycle_prompt_uses_entry_id_and_not_absolute_paths(self):
        tool_call = SimpleNamespace(
            function=SimpleNamespace(
                name=analysis_service.SUBMIT_ANALYSIS_TOOL_NAME,
                arguments='{"items": [{"entry_id": "F001", "entry_type": "file", "suggested_purpose": "财务/合同", "summary": "付款协议"}, {"entry_id": "F002", "entry_type": "dir", "suggested_purpose": "截图记录", "summary": "软件报错截图"}]}'
            )
        )
        response = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(tool_calls=[tool_call], content=""))]
        )
        create_mock = mock.Mock(return_value=response)
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create_mock)))

        with mock.patch.object(analysis_service, "get_client", return_value=client):
            rendered = analysis_service.run_analysis_cycle(self.base_dir)

        self.assertIn("付款协议", rendered)
        self.assertIn("软件报错截图", rendered)
        messages = create_mock.call_args.kwargs["messages"]
        self.assertIn("F001 |", messages[0]["content"])
        self.assertIn("F002 |", messages[0]["content"])
        self.assertNotIn(str(self.base_dir.resolve()), messages[0]["content"])

    def test_run_analysis_cycle_logs_when_image_entries_are_not_requested_for_inspection(self):
        image_path = self.base_dir / "IMG_001.png"
        image_path.write_bytes(b"fake-image")
        tool_call = SimpleNamespace(
            function=SimpleNamespace(
                name=analysis_service.SUBMIT_ANALYSIS_TOOL_NAME,
                arguments='{"items": [{"entry_id": "F001", "entry_type": "file", "suggested_purpose": "财务/合同", "summary": "付款协议"}, {"entry_id": "F002", "entry_type": "dir", "suggested_purpose": "截图记录", "summary": "软件报错截图"}, {"entry_id": "F003", "entry_type": "file", "suggested_purpose": "待判断", "summary": "未查看图片"}]}'
            )
        )
        response = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(tool_calls=[tool_call], content=""))]
        )
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=mock.Mock(return_value=response))))

        with mock.patch.object(analysis_service, "get_client", return_value=client), mock.patch.object(
            analysis_service, "_vision_prompt_enabled", return_value=True
        ), mock.patch.object(analysis_service, "_write_analysis_debug_event") as write_debug_event:
            analysis_service.run_analysis_cycle(self.base_dir)

        event_kinds = [call.args[1] for call in write_debug_event.call_args_list]
        self.assertIn("analysis.vision.skipped_not_requested", event_kinds)

    def test_extract_image_probe_statuses_parses_structured_image_blocks(self):
        result = (
            "--- 条目 [F001 | IMG_001.png] 内容开始 ---\n"
            "--- 图片识别结果开始 ---\n"
            "status: failed\n"
            "error_code: vision_request_failed\n"
            "error_message: provider failed\n"
            "--- 图片识别结果结束 ---\n"
            "--- 内容结束 ---"
        )

        statuses = analysis_service._extract_image_probe_statuses(result)

        self.assertEqual(statuses["F001"]["status"], "failed")
        self.assertEqual(statuses["F001"]["error_code"], "vision_request_failed")

    def test_validate_failed_image_probe_items_rejects_specific_scene_when_probe_failed(self):
        items = [
            AnalysisItem(
                entry_id="F001",
                entry_name="IMG_001.png",
                entry_type="file",
                suggested_purpose="图片/照片",
                summary="聚餐场景照片，显示多人围坐圆桌用餐",
            )
        ]

        failures = analysis_service._validate_failed_image_probe_items(
            items,
            {"F001": {"status": "failed", "error_code": "vision_request_failed", "error_message": "provider failed"}},
        )

        self.assertEqual(failures, ["F001"])

    def test_batch_read_tool_resolves_entry_ids_without_exposing_absolute_paths(self):
        entry_context = {
            "F001": {
                "entry_id": "F001",
                "entry_name": "合同.pdf",
                "display_name": "合同.pdf",
                "entry_type": "file",
                "absolute_path": str((self.base_dir / "合同.pdf").resolve()),
            }
        }

        result = analysis_service._dispatch_tool_call(
            self.base_dir,
            analysis_service.BATCH_READ_TOOL_NAME,
            {"entry_ids": ["F001"]},
            entry_context=entry_context,
        )

        self.assertIn("条目 [F001 | 合同.pdf] 内容开始", result)
        self.assertNotIn(str((self.base_dir / "合同.pdf").resolve()), result)

    def test_submit_analysis_tool_schema_no_longer_exposes_entry_name(self):
        submit_tool = next(
            tool
            for tool in analysis_service.tools
            if tool["function"]["name"] == analysis_service.SUBMIT_ANALYSIS_TOOL_NAME
        )

        item_properties = submit_tool["function"]["parameters"]["properties"]["items"]["items"]["properties"]
        self.assertNotIn("entry_name", item_properties)

    def test_run_analysis_cycle_serializes_tool_call_messages_before_retrying(self):
        first_response = SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content="",
                        tool_calls=[
                            SimpleNamespace(
                                id="call_1",
                                type="function",
                                function=SimpleNamespace(
                                    name="list_local_files",
                                    arguments='{"directory": ".", "max_depth": 0}',
                                ),
                            )
                        ],
                    )
                )
            ]
        )
        second_response = SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content="",
                        tool_calls=[
                            SimpleNamespace(
                                id="call_2",
                                type="function",
                                function=SimpleNamespace(
                                    name=analysis_service.SUBMIT_ANALYSIS_TOOL_NAME,
                                    arguments='{"items": [{"entry_id": "F002", "entry_type": "file", "suggested_purpose": "财务/合同", "summary": "付款协议"}, {"entry_id": "F001", "entry_type": "dir", "suggested_purpose": "截图记录", "summary": "软件报错截图"}]}',
                                ),
                            )
                        ],
                    )
                )
            ]
        )
        create_mock = mock.Mock(side_effect=[first_response, second_response])
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create_mock)))

        with mock.patch.object(analysis_service, "get_client", return_value=client), mock.patch.object(
            analysis_service, "list_local_files", return_value="示例文件列表"
        ), mock.patch.object(analysis_service, "_dispatch_tool_call", return_value="目录列表"):
            rendered = analysis_service.run_analysis_cycle(self.base_dir)

        self.assertIn("合同.pdf | file | 财务/合同 | 付款协议", rendered)
        self.assertEqual(create_mock.call_count, 2)
        second_messages = create_mock.call_args_list[1].kwargs["messages"]
        analysis_service.json.dumps(second_messages, ensure_ascii=False)
        self.assertEqual(second_messages[2]["role"], "assistant")
        self.assertEqual(second_messages[2]["tool_calls"][0]["function"]["name"], "list_local_files")

    def test_run_analysis_cycle_preserves_reasoning_content_before_retrying(self):
        first_response = SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content="",
                        reasoning_content="先判断目录结构，再决定是否补充读取。",
                        tool_calls=[
                            SimpleNamespace(
                                id="call_1",
                                type="function",
                                function=SimpleNamespace(
                                    name="list_local_files",
                                    arguments='{"directory": ".", "max_depth": 0}',
                                ),
                            )
                        ],
                    )
                )
            ]
        )
        second_response = SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content="",
                        tool_calls=[
                            SimpleNamespace(
                                id="call_2",
                                type="function",
                                function=SimpleNamespace(
                                    name=analysis_service.SUBMIT_ANALYSIS_TOOL_NAME,
                                    arguments='{"items": [{"entry_id": "F002", "entry_type": "file", "suggested_purpose": "财务/合同", "summary": "付款协议"}, {"entry_id": "F001", "entry_type": "dir", "suggested_purpose": "截图记录", "summary": "软件报错截图"}]}',
                                ),
                            )
                        ],
                    )
                )
            ]
        )
        create_mock = mock.Mock(side_effect=[first_response, second_response])
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create_mock)))

        with mock.patch.object(analysis_service, "get_client", return_value=client), mock.patch.object(
            analysis_service, "list_local_files", return_value="示例文件列表"
        ), mock.patch.object(analysis_service, "_dispatch_tool_call", return_value="目录列表"):
            analysis_service.run_analysis_cycle(self.base_dir)

        second_messages = create_mock.call_args_list[1].kwargs["messages"]
        self.assertEqual(second_messages[2]["reasoning_content"], "先判断目录结构，再决定是否补充读取。")

    def test_run_analysis_cycle_synthesizes_missing_tool_call_ids_before_retrying(self):
        first_response = SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content="",
                        tool_calls=[
                            SimpleNamespace(
                                id=None,
                                type="function",
                                function=SimpleNamespace(
                                    name="list_local_files",
                                    arguments='{"directory": ".", "max_depth": 0}',
                                ),
                            )
                        ],
                    )
                )
            ]
        )
        second_response = SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content="",
                        tool_calls=[
                            SimpleNamespace(
                                id="call_2",
                                type="function",
                                function=SimpleNamespace(
                                    name=analysis_service.SUBMIT_ANALYSIS_TOOL_NAME,
                                    arguments='{"items": [{"entry_id": "F002", "entry_type": "file", "suggested_purpose": "财务/合同", "summary": "付款协议"}, {"entry_id": "F001", "entry_type": "dir", "suggested_purpose": "截图记录", "summary": "软件报错截图"}]}',
                                ),
                            )
                        ],
                    )
                )
            ]
        )
        create_mock = mock.Mock(side_effect=[first_response, second_response])
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create_mock)))

        with mock.patch.object(analysis_service, "get_client", return_value=client), mock.patch.object(
            analysis_service, "list_local_files", return_value="示例文件列表"
        ), mock.patch.object(analysis_service, "_dispatch_tool_call", return_value="目录列表"):
            rendered = analysis_service.run_analysis_cycle(self.base_dir)

        self.assertIn("合同.pdf | file | 财务/合同 | 付款协议", rendered)
        second_messages = create_mock.call_args_list[1].kwargs["messages"]
        synthesized_id = second_messages[2]["tool_calls"][0]["id"]
        self.assertTrue(synthesized_id)
        self.assertEqual(second_messages[3]["tool_call_id"], synthesized_id)

    def test_run_analysis_cycle_accepts_plain_text_string_response(self):
        response = (
            "<output>\n"
            "合同.pdf | 财务/合同 | 付款协议\n"
            "Screenshots | 截图记录 | 软件报错截图\n"
            "</output>"
        )
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=mock.Mock(return_value=response))))

        with mock.patch.object(analysis_service, "get_client", return_value=client), mock.patch.object(
            analysis_service, "list_local_files", return_value="示例文件列表"
        ):
            rendered = analysis_service.run_analysis_cycle(self.base_dir)

        self.assertIn("合同.pdf | file | 财务/合同 | 付款协议", rendered)
        self.assertIn("Screenshots | dir | 截图记录 | 软件报错截图", rendered)

    def test_run_analysis_cycle_accepts_json_string_response(self):
        response = (
            '{"choices":[{"message":{"content":"<output>\\n'
            '合同.pdf | 财务/合同 | 付款协议\\n'
            'Screenshots | 截图记录 | 软件报错截图\\n'
            '</output>"}}]}'
        )
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=mock.Mock(return_value=response))))

        with mock.patch.object(analysis_service, "get_client", return_value=client), mock.patch.object(
            analysis_service, "list_local_files", return_value="示例文件列表"
        ):
            rendered = analysis_service.run_analysis_cycle(self.base_dir)

        self.assertIn("合同.pdf | file | 财务/合同 | 付款协议", rendered)
        self.assertIn("Screenshots | dir | 截图记录 | 软件报错截图", rendered)

    def test_run_analysis_cycle_falls_back_to_stream_when_non_stream_message_is_empty(self):
        empty_response = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=None, tool_calls=None, role="assistant"), finish_reason="stop")]
        )
        stream_response = [
            {"choices": [{"delta": {"role": "assistant"}, "finish_reason": None}]},
            {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "call_stream",
                                    "type": "function",
                                    "function": {
                                        "name": "submit_analysis_result",
                                        "arguments": '{"items": [{"entry_id": "F002", "entry_type": "file", "suggested_purpose": "finance/contract", "summary": "payment agreement"}, {"entry_id": "F001", "entry_type": "dir", "suggested_purpose": "screenshots", "summary": "error screenshots"}]}'
                                    },
                                }
                            ]
                        },
                        "finish_reason": "tool_calls",
                    }
                ]
            },
        ]
        create_mock = mock.Mock(side_effect=[empty_response, stream_response])
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create_mock)))

        with mock.patch.object(analysis_service, "get_client", return_value=client), mock.patch.object(
            analysis_service, "list_local_files", return_value="sample files"
        ):
            rendered = analysis_service.run_analysis_cycle(self.base_dir)

        self.assertIn("合同.pdf | file | finance/contract | payment agreement", rendered)
        self.assertEqual(create_mock.call_count, 2)
        self.assertNotIn("stream", create_mock.call_args_list[0].kwargs)
        self.assertTrue(create_mock.call_args_list[1].kwargs["stream"])

    def test_validate_analysis_returns_duplicates_key_for_missing_output(self):
        validation = analysis_service.validate_analysis("", self.base_dir)

        self.assertFalse(validation["is_valid"])
        self.assertIn("duplicates", validation)
        self.assertEqual(validation["duplicates"], [])


if __name__ == "__main__":
    unittest.main()
