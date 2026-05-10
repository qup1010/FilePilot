import os
import shutil
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from file_pilot.analysis.image_describer import ImageDescriptionResult, describe_image, format_image_description_result
from file_pilot.analysis.file_reader import read_local_file


class ImageDescriberTests(unittest.TestCase):
    def setUp(self):
        self.root_dir = Path("test_temp_image_describer")
        if self.root_dir.exists():
            shutil.rmtree(self.root_dir)
        self.root_dir.mkdir()
        self.image_path = self.root_dir / "sample.png"
        self.image_path.write_bytes(b"fake-image-bytes")

    def tearDown(self):
        if self.root_dir.exists():
            shutil.rmtree(self.root_dir)

    def test_describe_image_fails_in_strict_mode_when_config_missing(self):
        with mock.patch("file_pilot.analysis.image_describer.get_image_analysis_settings", return_value={"enabled": False}), mock.patch(
            "file_pilot.analysis.image_describer.append_debug_event"
        ) as append_debug_event:
            result = describe_image(self.image_path)

        self.assertEqual(result.status, "disabled")
        self.assertEqual(result.error_code, "vision_disabled")
        append_debug_event.assert_called_once()
        self.assertEqual(append_debug_event.call_args.kwargs["kind"], "analysis.vision.skipped_disabled")

    def test_describe_image_fails_when_explicit_vision_config_is_incomplete(self):
        with mock.patch(
            "file_pilot.analysis.image_describer.get_image_analysis_settings",
            return_value={
                "enabled": True,
                "base_url": "",
                "api_key": "secret",
                "model": "",
            },
        ), mock.patch(
            "file_pilot.analysis.image_describer.create_image_analysis_client",
            side_effect=ValueError("缺少必要配置: IMAGE_ANALYSIS_BASE_URL"),
        ):
            result = describe_image(self.image_path)

        self.assertEqual(result.status, "failed")
        self.assertEqual(result.error_code, "vision_missing_base_url")
        self.assertIn("IMAGE_ANALYSIS_BASE_URL", result.error_message)

    def test_describe_image_uses_isolated_messages_and_returns_short_summary(self):
        response = SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content="这是一张聊天截图，主要在讨论付款和交付时间。")
                )
            ]
        )
        mock_client = mock.Mock()
        mock_client.chat.completions.create.return_value = response

        with mock.patch(
            "file_pilot.analysis.image_describer.get_image_analysis_settings",
            return_value={
                "enabled": True,
                "base_url": "https://vision.example/v1",
                "api_key": "secret",
                "model": "vision-1",
            },
        ), mock.patch(
            "file_pilot.analysis.image_describer.create_image_analysis_client",
            return_value=mock_client,
        ), mock.patch("file_pilot.analysis.image_describer.append_debug_event") as append_debug_event:
            result = describe_image(self.image_path)

        self.assertEqual(result.status, "ok")
        self.assertEqual(result.summary, "这是一张聊天截图，主要在讨论付款和交付时间。")
        mock_client.chat.completions.create.assert_called_once()
        kwargs = mock_client.chat.completions.create.call_args.kwargs
        self.assertEqual(kwargs["model"], "vision-1")
        self.assertEqual(len(kwargs["messages"]), 2)
        self.assertEqual(kwargs["messages"][0]["role"], "system")
        self.assertEqual(kwargs["messages"][1]["role"], "user")
        self.assertNotIn("文件整理助手", str(kwargs["messages"]))
        event_kinds = [call.kwargs["kind"] for call in append_debug_event.call_args_list]
        self.assertEqual(event_kinds, ["analysis.vision.request_started", "analysis.vision.request_completed"])

    def test_describe_image_retries_local_http_image_when_data_url_rejected(self):
        response = SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content="图片中有一行测试文字。")
                )
            ]
        )
        mock_client = mock.Mock()
        mock_client.chat.completions.create.side_effect = [
            RuntimeError("The image data you provided does not represent a valid image."),
            response,
        ]

        with mock.patch(
            "file_pilot.analysis.image_describer.get_image_analysis_settings",
            return_value={
                "enabled": True,
                "base_url": "http://localhost:8317/v1",
                "api_key": "secret",
                "model": "vision-1",
            },
        ), mock.patch(
            "file_pilot.analysis.image_describer.create_image_analysis_client",
            return_value=mock_client,
        ), mock.patch(
            "file_pilot.analysis.image_describer.register_vision_image_file",
            return_value="image-token",
        ), mock.patch(
            "file_pilot.analysis.image_describer.build_registered_vision_image_url",
            return_value="http://127.0.0.1:8765/_filepilot/vision-images/image-token",
        ), mock.patch.dict(
            os.environ,
            {"FILEPILOT_VISION_HTTP_FALLBACK": "1"},
        ):
            result = describe_image(self.image_path)

        self.assertEqual(result.status, "ok")
        self.assertEqual(result.summary, "图片中有一行测试文字。")
        self.assertEqual(mock_client.chat.completions.create.call_count, 2)
        retry_messages = mock_client.chat.completions.create.call_args_list[1].kwargs["messages"]
        self.assertEqual(
            retry_messages[1]["content"][1]["image_url"]["url"],
            "http://127.0.0.1:8765/_filepilot/vision-images/image-token",
        )

    def test_describe_image_reports_provider_failure_without_fallback(self):
        mock_client = mock.Mock()
        mock_client.chat.completions.create.side_effect = RuntimeError("model does not support vision")

        with mock.patch(
            "file_pilot.analysis.image_describer.get_image_analysis_settings",
            return_value={
                "enabled": True,
                "base_url": "https://vision.example/v1",
                "api_key": "secret",
                "model": "vision-1",
            },
        ), mock.patch(
            "file_pilot.analysis.image_describer.create_image_analysis_client",
            return_value=mock_client,
        ), mock.patch("file_pilot.analysis.image_describer.append_debug_event") as append_debug_event:
            result = describe_image(self.image_path)

        self.assertEqual(result.status, "failed")
        self.assertEqual(result.error_code, "vision_request_failed")
        self.assertIn("model does not support vision", result.error_message)
        event_kinds = [call.kwargs["kind"] for call in append_debug_event.call_args_list]
        self.assertEqual(event_kinds, ["analysis.vision.request_started", "analysis.vision.request_failed"])

    def test_describe_image_accepts_plain_text_string_response(self):
        mock_client = mock.Mock()
        mock_client.chat.completions.create.return_value = "这是一张聊天截图，主要在讨论付款和交付时间。"

        with mock.patch(
            "file_pilot.analysis.image_describer.get_image_analysis_settings",
            return_value={
                "enabled": True,
                "base_url": "https://vision.example/v1",
                "api_key": "secret",
                "model": "vision-1",
            },
        ), mock.patch(
            "file_pilot.analysis.image_describer.create_image_analysis_client",
            return_value=mock_client,
        ):
            result = describe_image(self.image_path)

        self.assertEqual(result.status, "ok")
        self.assertEqual(result.summary, "这是一张聊天截图，主要在讨论付款和交付时间。")

    def test_describe_image_accepts_json_string_response(self):
        mock_client = mock.Mock()
        mock_client.chat.completions.create.return_value = (
            '{"choices":[{"message":{"content":"这是一张聊天截图，主要在讨论付款和交付时间。"}}]}'
        )

        with mock.patch(
            "file_pilot.analysis.image_describer.get_image_analysis_settings",
            return_value={
                "enabled": True,
                "base_url": "https://vision.example/v1",
                "api_key": "secret",
                "model": "vision-1",
            },
        ), mock.patch(
            "file_pilot.analysis.image_describer.create_image_analysis_client",
            return_value=mock_client,
        ):
            result = describe_image(self.image_path)

        self.assertEqual(result.status, "ok")
        self.assertEqual(result.summary, "这是一张聊天截图，主要在讨论付款和交付时间。")

    def test_format_image_description_result_builds_machine_readable_block(self):
        rendered = format_image_description_result(
            ImageDescriptionResult(
                status="failed",
                error_code="vision_request_failed",
                error_message="provider failed",
            )
        )

        self.assertIn("status: failed", rendered)
        self.assertIn("error_code: vision_request_failed", rendered)
        self.assertIn("error_message: provider failed", rendered)

    def test_read_local_file_wraps_image_result_in_stable_status_block(self):
        with mock.patch(
            "file_pilot.analysis.file_reader.describe_image",
            return_value=ImageDescriptionResult(status="ok", summary="测试图片摘要"),
        ):
            rendered = read_local_file(str(self.image_path))

        self.assertIn("--- 图片识别结果开始 ---", rendered)
        self.assertIn("status: ok", rendered)
        self.assertIn("summary: 测试图片摘要", rendered)


if __name__ == "__main__":
    unittest.main()
