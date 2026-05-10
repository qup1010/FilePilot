import io
import json
import os
from collections import Counter
import unittest
from unittest import mock
from urllib import error as urllib_error

from fastapi.testclient import TestClient

from file_pilot.api.main import create_app


class ApiConfigTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(create_app())

    def test_get_settings_returns_unified_snapshot(self):
        snapshot = {
            "global_config": {"DEBUG_MODE": False},
            "families": {
                "text": {
                    "family": "text",
                    "configured": True,
                    "active_preset_id": "default",
                    "active_preset": {
                        "id": "default",
                        "name": "默认文本模型",
                        "OPENAI_BASE_URL": "https://text.example/v1",
                        "OPENAI_MODEL": "gpt-5.2",
                        "secret_state": "stored",
                    },
                    "presets": [],
                },
                "vision": {
                    "family": "vision",
                    "enabled": True,
                    "mode": "shared_text",
                    "configured": False,
                    "active_preset_id": "default",
                    "active_preset": {
                        "id": "default",
                        "name": "默认图片模型",
                        "IMAGE_ANALYSIS_NAME": "默认图片模型",
                        "IMAGE_ANALYSIS_BASE_URL": "",
                        "IMAGE_ANALYSIS_MODEL": "",
                        "secret_state": "empty",
                    },
                    "presets": [],
                },
                "icon_image": {
                    "family": "icon_image",
                    "configured": False,
                    "active_preset_id": "default",
                    "active_preset": {
                        "id": "default",
                        "name": "默认图标生图",
                        "image_model": {"base_url": "", "model": "", "secret_state": "empty"},
                        "image_size": "1024x1024",
                        "analysis_concurrency_limit": 2,
                        "image_concurrency_limit": 1,
                        "save_mode": "centralized",
                        "text_model": {
                            "name": "默认文本模型",
                            "base_url": "https://text.example/v1",
                            "model": "gpt-5.2",
                            "secret_state": "stored",
                            "configured": True,
                        },
                    },
                    "presets": [],
                },
                "bg_removal": {
                    "family": "bg_removal",
                    "configured": True,
                    "mode": "preset",
                    "preset_id": "bria-rmbg-2.0",
                    "active_preset": {
                        "name": "BRIA RMBG 2.0",
                        "model_id": "briaai/BRIA-RMBG-2.0",
                        "api_type": "gradio_space",
                        "payload_template": '{"data":[{"path":"{{uploaded_path}}"}]}',
                        "secret_state": "empty",
                    },
                    "builtin_presets": [
                        {
                            "id": "bria-rmbg-2.0",
                            "name": "BRIA RMBG 2.0",
                            "model_id": "briaai/BRIA-RMBG-2.0",
                            "api_type": "gradio_space",
                            "payload_template": '{"data":[{"path":"{{uploaded_path}}"}]}',
                        }
                    ],
                    "custom": {
                        "name": "自定义抠图",
                        "model_id": "",
                        "api_type": "gradio_space",
                        "payload_template": "",
                        "secret_state": "empty",
                    },
                },
            },
            "status": {
                "text_configured": True,
                "vision_configured": False,
                "icon_image_configured": False,
                "bg_removal_configured": True,
            },
        }
        with mock.patch(
            "file_pilot.shared.config_manager.config_manager.service.get_settings_snapshot",
            return_value=snapshot,
        ):
            response = self.client.get("/api/settings")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"]["text_configured"], True)
        self.assertEqual(response.json()["families"]["text"]["active_preset"]["secret_state"], "stored")
        self.assertEqual(response.json()["families"]["bg_removal"]["preset_id"], "bria-rmbg-2.0")

    def test_patch_settings_forwards_atomic_payload(self):
        payload = {
            "global_config": {"DEBUG_MODE": True},
            "families": {
                "text": {
                    "preset": {"OPENAI_BASE_URL": "https://text.example/v1", "OPENAI_MODEL": "gpt-5.4"},
                    "secret": {"action": "replace", "value": "text-secret"},
                },
                "vision": {
                    "enabled": False,
                    "mode": "separate",
                    "preset": {"IMAGE_ANALYSIS_MODEL": "gpt-4.1-mini"},
                    "secret": {"action": "keep"},
                },
                "icon_image": {
                    "preset": {"image_model": {"base_url": "https://image.example/v1", "model": "gpt-image-1"}},
                    "secret": {"action": "clear"},
                },
                "bg_removal": {
                    "mode": "custom",
                    "custom": {
                        "name": "自定义抠图",
                        "model_id": "custom/rembg",
                        "api_type": "gradio_space",
                        "payload_template": '{"data":[{"path":"{{uploaded_path}}"}]}',
                    },
                    "secret": {"action": "replace", "value": "hf-token"},
                },
            },
        }
        expected_snapshot = {"status": {"text_configured": True}}
        with mock.patch(
            "file_pilot.shared.config_manager.config_manager.service.update_settings",
            return_value=expected_snapshot,
        ) as update_mock:
            response = self.client.patch("/api/settings", json=payload)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), expected_snapshot)
        update_mock.assert_called_once_with(payload)

    def test_get_runtime_family_returns_live_runtime_config(self):
        with mock.patch(
            "file_pilot.shared.config_manager.config_manager.service.get_runtime_family_config",
            return_value={
                "name": "BRIA RMBG 2.0",
                "model_id": "briaai/BRIA-RMBG-2.0",
                "api_type": "gradio_space",
                "payload_template": '{"data":[{"path":"{{uploaded_path}}"}]}',
                "api_token": "hf-secret",
            },
        ) as runtime_mock:
            response = self.client.get("/api/settings/runtime/bg_removal")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["model_id"], "briaai/BRIA-RMBG-2.0")
        self.assertEqual(response.json()["api_token"], "hf-secret")
        runtime_mock.assert_called_once_with("bg_removal")

    def test_settings_preset_routes_forward_to_unified_service(self):
        with mock.patch(
            "file_pilot.shared.config_manager.config_manager.service.add_preset",
            return_value="preset-2",
        ) as add_mock, mock.patch(
            "file_pilot.shared.config_manager.config_manager.service.activate_preset",
        ) as activate_mock, mock.patch(
            "file_pilot.shared.config_manager.config_manager.service.delete_preset",
        ) as delete_mock:
            created = self.client.post(
                "/api/settings/presets/text",
                json={
                    "name": "工作模型",
                    "copy_from_active": True,
                    "preset": {"OPENAI_MODEL": "gpt-5.4"},
                    "secret": {"action": "replace", "value": "next-secret"},
                },
            )
            activated = self.client.post("/api/settings/presets/text/preset-2/activate")
            deleted = self.client.delete("/api/settings/presets/text/preset-2")

        self.assertEqual(created.status_code, 200)
        self.assertEqual(created.json()["id"], "preset-2")
        add_mock.assert_called_once_with(
            "text",
            "工作模型",
            copy_from_active=True,
            preset_patch={"OPENAI_MODEL": "gpt-5.4"},
            secret_payload={"action": "replace", "value": "next-secret"},
        )
        self.assertEqual(activated.status_code, 200)
        activate_mock.assert_called_once_with("text", "preset-2")
        self.assertEqual(deleted.status_code, 200)
        delete_mock.assert_called_once_with("text", "preset-2")

    def test_config_secret_read_endpoint_is_disabled(self):
        response = self.client.post("/api/utils/config/secrets", json={"keys": ["OPENAI_API_KEY"]})

        self.assertEqual(response.status_code, 410)
        self.assertEqual(response.json()["detail"], "CONFIG_SECRET_READ_DISABLED")

    def test_legacy_get_config_still_masks_and_reports_state(self):
        legacy_payload = {
            "config": {
                "OPENAI_BASE_URL": "https://text.example/v1",
                "OPENAI_MODEL": "gpt-5.2",
                "OPENAI_API_KEY": "********",
                "OPENAI_API_KEY_STATE": "stored",
            },
            "text_presets": [{"id": "default", "name": "默认文本模型", "secret_state": "stored"}],
            "vision_presets": [{"id": "default", "name": "默认图片模型", "secret_state": "empty"}],
            "active_text_preset_id": "default",
            "active_vision_preset_id": "default",
            "status": {"text_configured": True, "vision_configured": False, "icon_image_configured": False},
        }
        with mock.patch(
            "file_pilot.shared.config_manager.config_manager.get_config_payload",
            return_value=legacy_payload,
        ):
            response = self.client.get("/api/utils/config")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["config"]["OPENAI_API_KEY"], "********")
        self.assertEqual(response.json()["config"]["OPENAI_API_KEY_STATE"], "stored")

    def test_test_settings_text_uses_real_completion_probe(self):
        mock_client = mock.Mock()
        mock_client.chat.completions.create.return_value = mock.Mock()
        with mock.patch("openai.OpenAI", return_value=mock_client) as openai_mock:
            response = self.client.post(
                "/api/settings/test",
                json={
                    "family": "text",
                    "preset": {
                        "name": "文本模型",
                        "OPENAI_BASE_URL": "https://text.example/v1",
                        "OPENAI_MODEL": "gpt-5.4",
                    },
                    "secret": {"action": "replace", "value": "text-secret"},
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        openai_mock.assert_called_once()
        self.assertEqual(openai_mock.call_args.kwargs["api_key"], "text-secret")
        self.assertEqual(openai_mock.call_args.kwargs["base_url"], "https://text.example/v1")
        mock_client.chat.completions.create.assert_called_once()

    def test_test_settings_vision_sends_inline_image_probe(self):
        mock_client = mock.Mock()
        mock_client.chat.completions.create.return_value = {
            "choices": [
                {
                    "message": {
                        "content": '{"seen_text":"vision\\n test 42"}',
                    }
                }
            ]
        }
        with mock.patch("openai.OpenAI", return_value=mock_client):
            response = self.client.post(
                "/api/settings/test",
                json={
                    "family": "vision",
                    "mode": "separate",
                    "preset": {
                        "name": "视觉模型",
                        "IMAGE_ANALYSIS_NAME": "视觉模型",
                        "IMAGE_ANALYSIS_BASE_URL": "https://vision.example/v1",
                        "IMAGE_ANALYSIS_MODEL": "gpt-4.1-mini",
                    },
                    "secret": {"action": "replace", "value": "vision-secret"},
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["message"], '已验证模型能够识别测试图中的 "VISION TEST 42"。')
        self.assertEqual(response.json()["details"]["expected"], "VISION TEST 42")
        messages = mock_client.chat.completions.create.call_args.kwargs["messages"]
        self.assertEqual(messages[1]["content"][1]["type"], "image_url")
        self.assertIn("data:image/", messages[1]["content"][1]["image_url"]["url"])
        self.assertIn(";base64,", messages[1]["content"][1]["image_url"]["url"])

    def test_test_settings_vision_shared_text_mode_uses_text_runtime(self):
        mock_client = mock.Mock()
        mock_client.chat.completions.create.return_value = {
            "choices": [
                {
                    "message": {
                        "content": '{"seen_text":"VISION TEST 42"}',
                    }
                }
            ]
        }
        with mock.patch("openai.OpenAI", return_value=mock_client) as openai_mock:
            response = self.client.post(
                "/api/settings/test",
                json={
                    "family": "vision",
                    "mode": "shared_text",
                    "preset": {
                        "name": "默认文本模型",
                        "OPENAI_BASE_URL": "https://text.example/v1",
                        "OPENAI_MODEL": "gpt-5.4",
                    },
                    "secret": {"action": "replace", "value": "text-secret"},
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        self.assertEqual(openai_mock.call_args.kwargs["api_key"], "text-secret")
        self.assertEqual(openai_mock.call_args.kwargs["base_url"], "https://text.example/v1")

    def test_test_settings_vision_retries_local_http_image_when_data_url_rejected(self):
        mock_client = mock.Mock()
        mock_client.chat.completions.create.side_effect = [
            RuntimeError("The image data you provided does not represent a valid image."),
            {
                "choices": [
                    {
                        "message": {
                            "content": '{"seen_text":"VISION TEST 42"}',
                        }
                    }
                ]
            },
        ]
        with mock.patch("openai.OpenAI", return_value=mock_client), mock.patch.dict(
            os.environ,
            {"FILEPILOT_VISION_HTTP_FALLBACK": "1"},
        ):
            response = self.client.post(
                "/api/settings/test",
                json={
                    "family": "vision",
                    "mode": "separate",
                    "preset": {
                        "name": "本地视觉模型",
                        "IMAGE_ANALYSIS_NAME": "本地视觉模型",
                        "IMAGE_ANALYSIS_BASE_URL": "http://localhost:8317/v1",
                        "IMAGE_ANALYSIS_MODEL": "gpt-5.2",
                    },
                    "secret": {"action": "replace", "value": "vision-secret"},
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(mock_client.chat.completions.create.call_count, 2)
        retry_messages = mock_client.chat.completions.create.call_args_list[1].kwargs["messages"]
        retry_url = retry_messages[1]["content"][1]["image_url"]["url"]
        self.assertTrue(retry_url.startswith("http://testserver/_filepilot/vision-images/"))

    def test_test_settings_vision_rejects_non_verified_result(self):
        mock_client = mock.Mock()
        mock_client.chat.completions.create.return_value = {
            "choices": [
                {
                    "message": {
                        "content": '{"seen_text":"hello world"}',
                    }
                }
            ]
        }
        with mock.patch("openai.OpenAI", return_value=mock_client):
            response = self.client.post(
                "/api/settings/test",
                json={
                    "family": "vision",
                    "mode": "separate",
                    "preset": {
                        "IMAGE_ANALYSIS_NAME": "视觉模型",
                        "IMAGE_ANALYSIS_BASE_URL": "https://vision.example/v1",
                        "IMAGE_ANALYSIS_MODEL": "gpt-4.1-mini",
                    },
                    "secret": {"action": "replace", "value": "vision-secret"},
                },
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "vision_not_verified")
        self.assertEqual(response.json()["details"]["expected"], "VISION TEST 42")
        self.assertEqual(response.json()["details"]["actual"], "hello world")

    def test_test_settings_icon_image_accepts_400_as_endpoint_reachable(self):
        with mock.patch("urllib.request.urlopen", side_effect=urllib_error.HTTPError(
            url="https://image.example/v1/images/generations",
            code=400,
            msg="Bad Request",
            hdrs=None,
            fp=io.BytesIO(b'{"error":"prompt is required"}'),
        )) as urlopen_mock:
            response = self.client.post(
                "/api/settings/test",
                json={
                    "family": "icon_image",
                    "preset": {
                        "name": "图标模型",
                        "image_model": {
                            "base_url": "https://image.example/v1",
                            "model": "gpt-image-1",
                        },
                        "image_size": "512x512",
                    },
                    "secret": {"action": "replace", "value": "image-secret"},
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        request_obj = urlopen_mock.call_args.args[0]
        payload = json.loads(request_obj.data.decode("utf-8"))
        self.assertEqual(payload, {"model": "gpt-image-1"})

    def test_test_settings_maps_error_category(self):
        mock_client = mock.Mock()
        mock_client.chat.completions.create.side_effect = RuntimeError("接口请求失败: 404 model not found")
        with mock.patch("openai.OpenAI", return_value=mock_client):
            response = self.client.post(
                "/api/settings/test",
                json={
                    "family": "text",
                    "preset": {
                        "OPENAI_BASE_URL": "https://text.example/v1",
                        "OPENAI_MODEL": "missing-model",
                    },
                    "secret": {"action": "replace", "value": "text-secret"},
                },
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "404")

    def test_test_settings_vision_reports_local_network_block(self):
        mock_client = mock.Mock()

        def raise_blocked_error(*args, **kwargs):
            try:
                raise OSError("[WinError 10013] 以一种访问权限不允许的方式做了一个访问套接字的尝试。")
            except OSError as cause:
                raise RuntimeError("Connection error.") from cause

        mock_client.chat.completions.create.side_effect = raise_blocked_error
        with mock.patch("openai.OpenAI", return_value=mock_client):
            response = self.client.post(
                "/api/settings/test",
                json={
                    "family": "vision",
                    "mode": "separate",
                    "preset": {
                        "IMAGE_ANALYSIS_NAME": "视觉模型",
                        "IMAGE_ANALYSIS_BASE_URL": "https://vision.example/v1",
                        "IMAGE_ANALYSIS_MODEL": "gpt-4.1-mini",
                    },
                    "secret": {"action": "replace", "value": "vision-secret"},
                },
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "network_blocked")
        self.assertIn("本机网络层阻止了这次连接请求", response.json()["message"])

    def test_test_settings_icon_image_reports_auth_failure(self):
        with mock.patch("urllib.request.urlopen", side_effect=urllib_error.HTTPError(
            url="https://image.example/v1/images/generations",
            code=401,
            msg="Unauthorized",
            hdrs=None,
            fp=io.BytesIO(b'{"error":"unauthorized"}'),
        )):
            response = self.client.post(
                "/api/settings/test",
                json={
                    "family": "icon_image",
                    "preset": {
                        "image_model": {
                            "base_url": "https://image.example/v1",
                            "model": "gpt-image-1",
                        }
                    },
                    "secret": {"action": "replace", "value": "image-secret"},
                },
            )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "401")

    def test_legacy_test_llm_keeps_masked_secret_as_stored_value(self):
        mock_client = mock.Mock()
        mock_client.chat.completions.create.return_value = mock.Mock()
        with mock.patch("openai.OpenAI", return_value=mock_client) as openai_mock, mock.patch(
            "file_pilot.shared.config_manager.config_manager.service.get_runtime_family_config",
            return_value={
                "name": "默认文本模型",
                "base_url": "https://text.example/v1",
                "model": "gpt-5.2",
                "api_key": "stored-text-key",
            },
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
        openai_mock.assert_called_once()
        self.assertEqual(openai_mock.call_args.kwargs["api_key"], "stored-text-key")
        self.assertEqual(openai_mock.call_args.kwargs["base_url"], "https://text.example/v1")

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
