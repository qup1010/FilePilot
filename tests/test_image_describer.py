import shutil
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from file_organizer.analysis.image_describer import describe_image


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
        with mock.patch("file_organizer.analysis.image_describer.get_image_analysis_settings", return_value={"enabled": False}):
            result = describe_image(self.image_path)

        self.assertIn("图片分析失败", result)

    def test_describe_image_fails_when_explicit_vision_config_is_incomplete(self):
        with mock.patch(
            "file_organizer.analysis.image_describer.get_image_analysis_settings",
            return_value={
                "enabled": True,
                "base_url": "",
                "api_key": "secret",
                "model": "",
            },
        ), mock.patch(
            "file_organizer.analysis.image_describer.create_image_analysis_client",
            side_effect=ValueError("缺少必要配置: IMAGE_ANALYSIS_BASE_URL"),
        ):
            result = describe_image(self.image_path)

        self.assertIn("图片分析失败", result)
        self.assertIn("IMAGE_ANALYSIS_BASE_URL", result)

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
            "file_organizer.analysis.image_describer.get_image_analysis_settings",
            return_value={
                "enabled": True,
                "base_url": "https://vision.example/v1",
                "api_key": "secret",
                "model": "vision-1",
            },
        ), mock.patch(
            "file_organizer.analysis.image_describer.create_image_analysis_client",
            return_value=mock_client,
        ):
            result = describe_image(self.image_path)

        self.assertEqual(result, "这是一张聊天截图，主要在讨论付款和交付时间。")
        mock_client.chat.completions.create.assert_called_once()
        kwargs = mock_client.chat.completions.create.call_args.kwargs
        self.assertEqual(kwargs["model"], "vision-1")
        self.assertEqual(len(kwargs["messages"]), 2)
        self.assertEqual(kwargs["messages"][0]["role"], "system")
        self.assertEqual(kwargs["messages"][1]["role"], "user")
        self.assertNotIn("文件整理助手", str(kwargs["messages"]))

    def test_describe_image_reports_provider_failure_without_fallback(self):
        mock_client = mock.Mock()
        mock_client.chat.completions.create.side_effect = RuntimeError("model does not support vision")

        with mock.patch(
            "file_organizer.analysis.image_describer.get_image_analysis_settings",
            return_value={
                "enabled": True,
                "base_url": "https://vision.example/v1",
                "api_key": "secret",
                "model": "vision-1",
            },
        ), mock.patch(
            "file_organizer.analysis.image_describer.create_image_analysis_client",
            return_value=mock_client,
        ):
            result = describe_image(self.image_path)

        self.assertIn("图片分析失败", result)
        self.assertIn("model does not support vision", result)

    def test_describe_image_accepts_plain_text_string_response(self):
        mock_client = mock.Mock()
        mock_client.chat.completions.create.return_value = "这是一张聊天截图，主要在讨论付款和交付时间。"

        with mock.patch(
            "file_organizer.analysis.image_describer.get_image_analysis_settings",
            return_value={
                "enabled": True,
                "base_url": "https://vision.example/v1",
                "api_key": "secret",
                "model": "vision-1",
            },
        ), mock.patch(
            "file_organizer.analysis.image_describer.create_image_analysis_client",
            return_value=mock_client,
        ):
            result = describe_image(self.image_path)

        self.assertEqual(result, "这是一张聊天截图，主要在讨论付款和交付时间。")

    def test_describe_image_accepts_json_string_response(self):
        mock_client = mock.Mock()
        mock_client.chat.completions.create.return_value = (
            '{"choices":[{"message":{"content":"这是一张聊天截图，主要在讨论付款和交付时间。"}}]}'
        )

        with mock.patch(
            "file_organizer.analysis.image_describer.get_image_analysis_settings",
            return_value={
                "enabled": True,
                "base_url": "https://vision.example/v1",
                "api_key": "secret",
                "model": "vision-1",
            },
        ), mock.patch(
            "file_organizer.analysis.image_describer.create_image_analysis_client",
            return_value=mock_client,
        ):
            result = describe_image(self.image_path)

        self.assertEqual(result, "这是一张聊天截图，主要在讨论付款和交付时间。")


if __name__ == "__main__":
    unittest.main()
