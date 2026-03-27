import unittest
from unittest import mock

from fastapi.testclient import TestClient

from file_organizer.api.main import create_app


class ApiConfigTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(create_app())

    def test_get_config_returns_dual_preset_payload(self):
        with mock.patch(
            "file_organizer.shared.config_manager.config_manager.get_config_payload",
            return_value={
                "config": {"OPENAI_MODEL": "gpt-5.2"},
                "text_presets": [{"id": "default", "name": "默认文本模型"}],
                "vision_presets": [{"id": "default", "name": "默认图片模型"}],
                "active_text_preset_id": "default",
                "active_vision_preset_id": "default",
            },
        ):
            response = self.client.get("/api/utils/config")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["config"], {"OPENAI_MODEL": "gpt-5.2"})
        self.assertEqual(response.json()["active_text_preset_id"], "default")

    def test_switch_preset_calls_config_manager(self):
        with mock.patch("file_organizer.shared.config_manager.config_manager.switch_preset") as switch_mock:
            response = self.client.post(
                "/api/utils/config/presets/switch",
                json={"preset_type": "text", "id": "work"},
            )

        self.assertEqual(response.status_code, 200)
        switch_mock.assert_called_once_with("text", "work")

    def test_add_preset_calls_config_manager(self):
        with mock.patch("file_organizer.shared.config_manager.config_manager.add_preset", return_value="new-id") as add_mock:
            response = self.client.post(
                "/api/utils/config/presets",
                json={"preset_type": "vision", "name": "Qwen Vision", "copy": True},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], "new-id")
        add_mock.assert_called_once_with("vision", "Qwen Vision", copy_from_active=True)

    def test_test_llm_rejects_incomplete_text_config(self):
        response = self.client.post(
            "/api/utils/test-llm",
            json={"test_type": "text", "OPENAI_BASE_URL": "", "OPENAI_MODEL": "gpt-5.2", "OPENAI_API_KEY": ""},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["message"], "文本模型需要完整填写接口地址、模型 ID 和 API 密钥")

    def test_test_llm_rejects_incomplete_vision_config_without_fallback(self):
        response = self.client.post(
            "/api/utils/test-llm",
            json={
                "test_type": "vision",
                "IMAGE_ANALYSIS_ENABLED": True,
                "IMAGE_ANALYSIS_BASE_URL": "",
                "IMAGE_ANALYSIS_MODEL": "",
                "IMAGE_ANALYSIS_API_KEY": "",
                "OPENAI_BASE_URL": "https://text.example/v1",
                "OPENAI_API_KEY": "text-secret",
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["message"], "图片模型需要完整填写接口地址、模型 ID 和 API 密钥")

    def test_test_llm_uses_masked_secret_from_config_manager(self):
        mock_client = mock.Mock()
        mock_client.models.list.return_value = []

        with mock.patch("openai.OpenAI", return_value=mock_client) as openai_mock, mock.patch(
            "file_organizer.shared.config_manager.config_manager.get",
            return_value="persisted-secret",
        ):
            response = self.client.post(
                "/api/utils/test-llm",
                json={
                    "test_type": "text",
                    "OPENAI_BASE_URL": "https://text.example/v1",
                    "OPENAI_MODEL": "gpt-5.2",
                    "OPENAI_API_KEY": "sk-abcd...wxyz",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        openai_mock.assert_called_once_with(api_key="persisted-secret", base_url="https://text.example/v1")


if __name__ == "__main__":
    unittest.main()
