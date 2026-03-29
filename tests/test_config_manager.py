import json
import os
import shutil
import unittest
from pathlib import Path
from unittest import mock

from file_organizer.shared import config_manager as config_module


class ConfigManagerPresetTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_config_manager")
        if self.root.exists():
            shutil.rmtree(self.root)
        self.root.mkdir()
        self.config_path = self.root / "config.json"
        self.original_config_path = config_module.CONFIG_PATH
        config_module.CONFIG_PATH = self.config_path

    def tearDown(self):
        config_module.CONFIG_PATH = self.original_config_path
        if self.root.exists():
            shutil.rmtree(self.root)

    def test_sync_from_legacy_env_persists_secret_values(self):
        with mock.patch.dict(
            os.environ,
            {
                "OPENAI_API_KEY": "test-openai-secret",
                "IMAGE_ANALYSIS_API_KEY": "test-image-secret",
                "OPENAI_BASE_URL": "https://example.invalid/v1",
                "IMAGE_ANALYSIS_ENABLED": "true",
            },
            clear=False,
        ):
            manager = config_module.ConfigManager()

        payload = json.loads(self.config_path.read_text(encoding="utf-8"))
        text_preset = payload["text_presets"]["default"]
        vision_preset = payload["vision_presets"]["default"]

        self.assertEqual(text_preset["OPENAI_API_KEY"], "test-openai-secret")
        self.assertEqual(vision_preset["IMAGE_ANALYSIS_API_KEY"], "test-image-secret")
        self.assertEqual(text_preset["OPENAI_BASE_URL"], "https://example.invalid/v1")
        self.assertTrue(payload["global_config"]["IMAGE_ANALYSIS_ENABLED"])
        self.assertEqual(manager.get("OPENAI_API_KEY"), "test-openai-secret")
        self.assertEqual(manager.get("IMAGE_ANALYSIS_API_KEY"), "test-image-secret")

    def test_update_active_profile_updates_active_text_and_vision_presets(self):
        manager = config_module.ConfigManager()

        manager.update_active_profile(
            {
                "name": "OpenAI 主链路",
                "OPENAI_BASE_URL": "https://runtime.invalid/v1",
                "OPENAI_MODEL": "gpt-5.2",
                "OPENAI_API_KEY": "runtime-openai-secret",
                "IMAGE_ANALYSIS_NAME": "图片专用",
                "IMAGE_ANALYSIS_BASE_URL": "https://vision.invalid/v1",
                "IMAGE_ANALYSIS_MODEL": "gpt-4o",
                "IMAGE_ANALYSIS_API_KEY": "runtime-image-secret",
                "DEBUG_MODE": True,
            }
        )

        payload = json.loads(self.config_path.read_text(encoding="utf-8"))
        self.assertEqual(payload["text_presets"]["default"]["name"], "OpenAI 主链路")
        self.assertEqual(payload["vision_presets"]["default"]["name"], "图片专用")
        self.assertEqual(payload["vision_presets"]["default"]["IMAGE_ANALYSIS_NAME"], "图片专用")
        self.assertEqual(payload["text_presets"]["default"]["OPENAI_API_KEY"], "runtime-openai-secret")
        self.assertEqual(payload["vision_presets"]["default"]["IMAGE_ANALYSIS_API_KEY"], "runtime-image-secret")
        self.assertEqual(payload["global_config"]["DEBUG_MODE"], True)
        self.assertEqual(manager.get("OPENAI_API_KEY"), "runtime-openai-secret")
        self.assertEqual(manager.get("IMAGE_ANALYSIS_API_KEY"), "runtime-image-secret")

    def test_restart_keeps_saved_secret_values(self):
        manager = config_module.ConfigManager()
        manager.update_active_profile(
            {
                "OPENAI_BASE_URL": "https://persisted.invalid/v1",
                "OPENAI_MODEL": "gpt-5.2",
                "OPENAI_API_KEY": "persisted-openai-secret",
                "IMAGE_ANALYSIS_BASE_URL": "https://vision.invalid/v1",
                "IMAGE_ANALYSIS_MODEL": "gpt-4o",
                "IMAGE_ANALYSIS_API_KEY": "persisted-image-secret",
            }
        )

        restarted = config_module.ConfigManager()
        active = restarted.get_active_config(mask_secrets=False)

        self.assertEqual(active["OPENAI_API_KEY"], "persisted-openai-secret")
        self.assertEqual(active["IMAGE_ANALYSIS_API_KEY"], "persisted-image-secret")

    def test_legacy_single_config_is_migrated_to_dual_presets(self):
        self.config_path.write_text(
            json.dumps(
                {
                    "config": {
                        "name": "旧文本",
                        "OPENAI_BASE_URL": "https://persisted.invalid/v1",
                        "OPENAI_MODEL": "persisted-model",
                        "IMAGE_ANALYSIS_NAME": "旧图片",
                        "IMAGE_ANALYSIS_BASE_URL": "https://vision.invalid/v1",
                        "IMAGE_ANALYSIS_MODEL": "vision-model",
                    }
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        manager = config_module.ConfigManager()
        payload = json.loads(self.config_path.read_text(encoding="utf-8"))
        active = manager.get_active_config(mask_secrets=False)

        self.assertEqual(active["name"], "旧文本")
        self.assertEqual(active["IMAGE_ANALYSIS_NAME"], "旧图片")
        self.assertEqual(payload["text_presets"]["default"]["OPENAI_MODEL"], "persisted-model")
        self.assertEqual(payload["vision_presets"]["default"]["IMAGE_ANALYSIS_MODEL"], "vision-model")

    def test_legacy_profiles_file_is_flattened_to_active_dual_presets(self):
        self.config_path.write_text(
            json.dumps(
                {
                    "active_profile_id": "work",
                    "profiles": {
                        "default": {"name": "默认配置", "OPENAI_MODEL": "default-model"},
                        "work": {
                            "name": "工作文本",
                            "OPENAI_MODEL": "work-model",
                            "IMAGE_ANALYSIS_NAME": "工作图片",
                            "IMAGE_ANALYSIS_MODEL": "work-vision",
                            "LAUNCH_DEFAULT_NOTE": "工作目录",
                        },
                    },
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        manager = config_module.ConfigManager()
        payload = json.loads(self.config_path.read_text(encoding="utf-8"))
        active = manager.get_active_config(mask_secrets=False)

        self.assertEqual(active["name"], "工作文本")
        self.assertEqual(active["OPENAI_MODEL"], "work-model")
        self.assertEqual(active["IMAGE_ANALYSIS_NAME"], "工作图片")
        self.assertEqual(active["LAUNCH_DEFAULT_NOTE"], "工作目录")
        self.assertEqual(payload["text_presets"]["default"]["OPENAI_MODEL"], "work-model")
        self.assertEqual(payload["vision_presets"]["default"]["IMAGE_ANALYSIS_MODEL"], "work-vision")

    def test_add_switch_delete_text_preset_are_independent(self):
        manager = config_module.ConfigManager()
        manager.update_active_profile({"OPENAI_MODEL": "gpt-5.2", "OPENAI_API_KEY": "secret-a"})

        new_id = manager.add_preset("text", "Anthropic 兼容", copy_from_active=True)
        manager.update_active_profile({"OPENAI_MODEL": "claude-compatible"})

        manager.switch_preset("text", "default")
        active = manager.get_active_config(mask_secrets=False)

        self.assertEqual(active["OPENAI_MODEL"], "gpt-5.2")

        manager.delete_preset("text", new_id)
        payload = json.loads(self.config_path.read_text(encoding="utf-8"))
        self.assertNotIn(new_id, payload["text_presets"])

    def test_add_switch_delete_vision_preset_are_independent(self):
        manager = config_module.ConfigManager()
        manager.update_active_profile(
            {
                "IMAGE_ANALYSIS_NAME": "默认图片",
                "IMAGE_ANALYSIS_BASE_URL": "https://vision-a.invalid/v1",
                "IMAGE_ANALYSIS_MODEL": "vision-a",
                "IMAGE_ANALYSIS_API_KEY": "secret-a",
            }
        )

        new_id = manager.add_preset("vision", "Qwen Vision", copy_from_active=True)
        manager.update_active_profile({"IMAGE_ANALYSIS_NAME": "Qwen Vision", "IMAGE_ANALYSIS_MODEL": "qwen-vl"})

        manager.switch_preset("vision", "default")
        active = manager.get_active_config(mask_secrets=False)

        self.assertEqual(active["IMAGE_ANALYSIS_MODEL"], "vision-a")

        manager.delete_preset("vision", new_id)
        payload = json.loads(self.config_path.read_text(encoding="utf-8"))
        self.assertNotIn(new_id, payload["vision_presets"])

    def test_add_text_preset_uses_current_edit_values_when_patch_provided(self):
        manager = config_module.ConfigManager()
        manager.update_active_profile({"OPENAI_MODEL": "gpt-5.2", "OPENAI_API_KEY": "secret-a"})

        new_id = manager.add_preset(
            "text",
            "OpenAI 备用",
            copy_from_active=True,
            config_patch={
                "OPENAI_BASE_URL": "https://backup.invalid/v1",
                "OPENAI_MODEL": "gpt-5.4",
                "OPENAI_API_KEY": "secret-b",
            },
        )

        manager.switch_preset("text", new_id)
        active = manager.get_active_config(mask_secrets=False)

        self.assertEqual(active["name"], "OpenAI 备用")
        self.assertEqual(active["OPENAI_BASE_URL"], "https://backup.invalid/v1")
        self.assertEqual(active["OPENAI_MODEL"], "gpt-5.4")
        self.assertEqual(active["OPENAI_API_KEY"], "secret-b")

    def test_add_vision_preset_keeps_existing_secret_when_patch_secret_is_masked(self):
        manager = config_module.ConfigManager()
        manager.update_active_profile(
            {
                "IMAGE_ANALYSIS_NAME": "默认图片",
                "IMAGE_ANALYSIS_BASE_URL": "https://vision-a.invalid/v1",
                "IMAGE_ANALYSIS_MODEL": "vision-a",
                "IMAGE_ANALYSIS_API_KEY": "secret-a",
            }
        )

        new_id = manager.add_preset(
            "vision",
            "Vision 备用",
            copy_from_active=True,
            config_patch={
                "IMAGE_ANALYSIS_BASE_URL": "https://vision-b.invalid/v1",
                "IMAGE_ANALYSIS_MODEL": "vision-b",
                "IMAGE_ANALYSIS_API_KEY": "sk-abcd...wxyz",
            },
        )

        manager.switch_preset("vision", new_id)
        active = manager.get_active_config(mask_secrets=False)

        self.assertEqual(active["IMAGE_ANALYSIS_NAME"], "Vision 备用")
        self.assertEqual(active["IMAGE_ANALYSIS_BASE_URL"], "https://vision-b.invalid/v1")
        self.assertEqual(active["IMAGE_ANALYSIS_MODEL"], "vision-b")
        self.assertEqual(active["IMAGE_ANALYSIS_API_KEY"], "secret-a")

    def test_default_config_includes_launch_defaults(self):
        manager = config_module.ConfigManager()
        active = manager.get_active_config(mask_secrets=False)

        self.assertEqual(active["LAUNCH_DEFAULT_TEMPLATE_ID"], "general_downloads")
        self.assertEqual(active["LAUNCH_DEFAULT_NAMING_STYLE"], "zh")
        self.assertEqual(active["LAUNCH_DEFAULT_CAUTION_LEVEL"], "balanced")
        self.assertEqual(active["LAUNCH_DEFAULT_NOTE"], "")
        self.assertFalse(active["LAUNCH_SKIP_STRATEGY_PROMPT"])

    def test_get_config_payload_returns_dual_preset_metadata(self):
        manager = config_module.ConfigManager()
        payload = manager.get_config_payload(mask_secrets=True)

        self.assertIn("text_presets", payload)
        self.assertIn("vision_presets", payload)
        self.assertEqual(payload["active_text_preset_id"], "default")
        self.assertEqual(payload["active_vision_preset_id"], "default")


if __name__ == "__main__":
    unittest.main()
