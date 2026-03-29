from collections import Counter
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

    def test_get_config_secrets_returns_requested_secret_values(self):
        with mock.patch(
            "file_organizer.shared.config_manager.config_manager.get_secret_values",
            return_value={"OPENAI_API_KEY": "sk-live-secret"},
        ) as secrets_mock:
            response = self.client.post(
                "/api/utils/config/secrets",
                json={"keys": ["OPENAI_API_KEY"]},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["secrets"], {"OPENAI_API_KEY": "sk-live-secret"})
        secrets_mock.assert_called_once_with(["OPENAI_API_KEY"])

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

    def test_test_llm_uses_stored_secret_only_when_frontend_explicitly_requests_it(self):
        mock_client = mock.Mock()
        mock_client.chat.completions.create.return_value = mock.Mock()

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
                    "OPENAI_API_KEY_USE_STORED": True,
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        openai_mock.assert_called_once_with(api_key="persisted-secret", base_url="https://text.example/v1")
        mock_client.chat.completions.create.assert_called_once_with(
            model="gpt-5.2",
            messages=[{"role": "user", "content": "ping"}],
            max_tokens=1,
        )

    def test_test_llm_rejects_masked_secret_without_explicit_reuse_flag(self):
        with mock.patch("file_organizer.shared.config_manager.config_manager.get") as get_mock:
            response = self.client.post(
                "/api/utils/test-llm",
                json={
                    "test_type": "text",
                    "OPENAI_BASE_URL": "https://text.example/v1",
                    "OPENAI_MODEL": "gpt-5.2",
                    "OPENAI_API_KEY": "sk-abcd...wxyz",
                },
            )

        self.assertEqual(response.status_code, 400)
        self.assertIn("脱敏展示值", response.json()["message"])
        get_mock.assert_not_called()

    def test_create_app_does_not_register_duplicate_api_routes(self):
        route_counts = Counter(
            (
                tuple(sorted(route.methods or [])),
                route.path,
            )
            for route in self.client.app.routes
            if route.path.startswith("/api/")
        )

        duplicates = {
            f"{','.join(methods)} {path}": count
            for (methods, path), count in route_counts.items()
            if count > 1
        }

        self.assertEqual(duplicates, {})


if __name__ == "__main__":
    unittest.main()
