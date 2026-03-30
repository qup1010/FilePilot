import json
import shutil
import unittest
from pathlib import Path

from file_organizer.shared.settings_service import SettingsService


class SettingsServiceTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_settings_service")
        if self.root.exists():
            shutil.rmtree(self.root)
        self.root.mkdir(parents=True)
        self.config_path = self.root / "config.json"
        self.legacy_icon_path = self.root / "output" / "icon_workbench" / "config.json"
        self.legacy_icon_path.parent.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        if self.root.exists():
            shutil.rmtree(self.root)

    def test_migrates_legacy_icon_config_into_unified_root_schema(self):
        self.config_path.write_text(
            json.dumps(
                {
                    "config": {
                        "name": "默认文本模型",
                        "OPENAI_BASE_URL": "https://text.example/v1",
                        "OPENAI_MODEL": "gpt-5.2",
                        "OPENAI_API_KEY": "text-secret",
                    }
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        self.legacy_icon_path.write_text(
            json.dumps(
                {
                    "name": "旧图标生图",
                    "image_model": {
                        "base_url": "https://image.example/v1",
                        "model": "gpt-image-1",
                        "api_key": "image-secret",
                    },
                    "image_size": "512x512",
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        service = SettingsService(
            config_path=self.config_path,
            legacy_icon_config_path=self.legacy_icon_path,
        )
        saved = json.loads(self.config_path.read_text(encoding="utf-8"))
        runtime_icon = service.get_runtime_family_config("icon_image")

        self.assertIn("icon_image_presets", saved)
        self.assertEqual(saved["text_presets"]["default"]["OPENAI_API_KEY"], "text-secret")
        self.assertEqual(saved["icon_image_presets"]["default"]["image_model"]["api_key"], "image-secret")
        self.assertNotIn("OPENAI_API_KEY", saved["icon_image_presets"]["default"])
        self.assertEqual(runtime_icon["text_model"]["api_key"], "text-secret")

    def test_public_snapshot_never_exposes_plaintext_secrets(self):
        service = SettingsService(
            config_path=self.config_path,
            legacy_icon_config_path=self.legacy_icon_path,
        )
        service.update_settings(
            {
                "families": {
                    "text": {
                        "preset": {
                            "OPENAI_BASE_URL": "https://text.example/v1",
                            "OPENAI_MODEL": "gpt-5.4",
                        },
                        "secret": {"action": "replace", "value": "text-secret"},
                    },
                    "vision": {
                        "enabled": True,
                        "preset": {
                            "IMAGE_ANALYSIS_NAME": "视觉模型",
                            "IMAGE_ANALYSIS_BASE_URL": "https://vision.example/v1",
                            "IMAGE_ANALYSIS_MODEL": "gpt-4.1-mini",
                        },
                        "secret": {"action": "replace", "value": "vision-secret"},
                    },
                    "icon_image": {
                        "preset": {
                            "image_model": {
                                "base_url": "https://image.example/v1",
                                "model": "gpt-image-1",
                            }
                        },
                        "secret": {"action": "replace", "value": "image-secret"},
                    },
                }
            }
        )

        snapshot = service.get_settings_snapshot()
        serialized = json.dumps(snapshot, ensure_ascii=False)

        self.assertNotIn("text-secret", serialized)
        self.assertNotIn("vision-secret", serialized)
        self.assertNotIn("image-secret", serialized)
        self.assertEqual(snapshot["families"]["text"]["active_preset"]["secret_state"], "stored")
        self.assertEqual(snapshot["families"]["vision"]["active_preset"]["secret_state"], "stored")
        self.assertEqual(snapshot["families"]["icon_image"]["active_preset"]["image_model"]["secret_state"], "stored")

    def test_failed_atomic_update_does_not_write_partial_changes(self):
        service = SettingsService(
            config_path=self.config_path,
            legacy_icon_config_path=self.legacy_icon_path,
        )
        service.update_settings(
            {
                "families": {
                    "text": {
                        "preset": {
                            "OPENAI_BASE_URL": "https://text.example/v1",
                            "OPENAI_MODEL": "gpt-5.2",
                        },
                        "secret": {"action": "replace", "value": "stable-text-secret"},
                    }
                }
            }
        )
        before_file = self.config_path.read_text(encoding="utf-8")
        before_runtime = service.get_runtime_family_config("text")

        with self.assertRaises(ValueError):
            service.update_settings(
                {
                    "families": {
                        "text": {
                            "preset": {"OPENAI_MODEL": "gpt-5.4"},
                            "secret": {"action": "keep"},
                        },
                        "icon_image": {
                            "preset": {
                                "image_model": {
                                    "base_url": "https://image.example/v1",
                                    "model": "gpt-image-1",
                                }
                            },
                            "secret": {"action": "unexpected"},
                        },
                    }
                }
            )

        after_file = self.config_path.read_text(encoding="utf-8")
        after_runtime = service.get_runtime_family_config("text")
        self.assertEqual(before_file, after_file)
        self.assertEqual(before_runtime["model"], after_runtime["model"])
        self.assertEqual(after_runtime["api_key"], "stable-text-secret")


if __name__ == "__main__":
    unittest.main()
