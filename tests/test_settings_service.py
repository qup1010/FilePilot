import json
import os
import shutil
import unittest
from pathlib import Path
from unittest import mock

from file_pilot.shared.settings_service import SettingsService


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
        self.assertEqual(runtime_icon["analysis_concurrency_limit"], 2)
        self.assertEqual(runtime_icon["image_concurrency_limit"], 1)

    def test_public_snapshot_never_exposes_plaintext_secrets(self):
        service = SettingsService(
            config_path=self.config_path,
            legacy_icon_config_path=self.legacy_icon_path,
        )
        service.update_settings(
            {
                "global_config": {
                    "LAUNCH_DEFAULT_ORGANIZE_METHOD": "assign_into_existing_categories",
                    "LAUNCH_DEFAULT_TARGET_PROFILE_ID": "profile-work",
                },
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
                        "mode": "separate",
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
        self.assertEqual(snapshot["global_config"]["LAUNCH_DEFAULT_ORGANIZE_METHOD"], "assign_into_existing_categories")
        self.assertEqual(snapshot["global_config"]["LAUNCH_DEFAULT_TARGET_PROFILE_ID"], "profile-work")
        self.assertEqual(snapshot["families"]["text"]["active_preset"]["secret_state"], "stored")
        self.assertEqual(snapshot["families"]["vision"]["active_preset"]["secret_state"], "stored")
        self.assertEqual(snapshot["families"]["vision"]["mode"], "separate")
        self.assertEqual(snapshot["families"]["icon_image"]["active_preset"]["image_model"]["secret_state"], "stored")
        self.assertIn("analysis_concurrency_limit", snapshot["families"]["icon_image"]["active_preset"])
        self.assertIn("image_concurrency_limit", snapshot["families"]["icon_image"]["active_preset"])
        self.assertTrue(snapshot["runtime"]["log_paths"]["runtime_log"].endswith("logs\\backend\\runtime.log"))
        self.assertTrue(snapshot["runtime"]["log_paths"]["debug_log"].endswith("logs\\backend\\debug.jsonl"))

    def test_icon_image_runtime_supports_split_concurrency_limits(self):
        service = SettingsService(
            config_path=self.config_path,
            legacy_icon_config_path=self.legacy_icon_path,
        )
        service.update_settings(
            {
                "families": {
                    "icon_image": {
                        "preset": {
                            "image_model": {
                                "base_url": "https://image.example/v1",
                                "model": "gpt-image-1",
                            },
                            "analysis_concurrency_limit": 4,
                            "image_concurrency_limit": 2,
                        },
                        "secret": {"action": "replace", "value": "image-secret"},
                    },
                }
            }
        )

        runtime = service.get_runtime_family_config("icon_image")
        snapshot = service.get_settings_snapshot()

        self.assertEqual(runtime["analysis_concurrency_limit"], 4)
        self.assertEqual(runtime["image_concurrency_limit"], 2)
        self.assertEqual(snapshot["families"]["icon_image"]["active_preset"]["analysis_concurrency_limit"], 4)
        self.assertEqual(snapshot["families"]["icon_image"]["active_preset"]["image_concurrency_limit"], 2)

    def test_add_vision_preset_prefers_explicit_name_over_stale_patch_name(self):
        service = SettingsService(
            config_path=self.config_path,
            legacy_icon_config_path=self.legacy_icon_path,
        )
        service.update_settings(
            {
                "families": {
                    "vision": {
                        "preset": {
                            "IMAGE_ANALYSIS_NAME": "默认图片模型",
                            "IMAGE_ANALYSIS_BASE_URL": "https://vision.example/v1",
                            "IMAGE_ANALYSIS_MODEL": "gpt-4.1-mini",
                        },
                        "secret": {"action": "replace", "value": "vision-secret"},
                    }
                }
            }
        )

        preset_id = service.add_preset(
            "vision",
            "我的图片预设",
            copy_from_active=True,
            preset_patch={
                "IMAGE_ANALYSIS_NAME": "默认图片模型",
                "IMAGE_ANALYSIS_BASE_URL": "https://vision-backup.example/v1",
                "IMAGE_ANALYSIS_MODEL": "gpt-4.1",
            },
        )

        snapshot = service.get_settings_snapshot()
        saved = json.loads(self.config_path.read_text(encoding="utf-8"))
        active = snapshot["families"]["vision"]["active_preset"]

        self.assertEqual(snapshot["families"]["vision"]["active_preset_id"], preset_id)
        self.assertEqual(active["name"], "我的图片预设")
        self.assertEqual(active["IMAGE_ANALYSIS_NAME"], "我的图片预设")
        self.assertEqual(active["IMAGE_ANALYSIS_BASE_URL"], "https://vision-backup.example/v1")
        self.assertEqual(active["IMAGE_ANALYSIS_MODEL"], "gpt-4.1")
        self.assertEqual(saved["vision_presets"][preset_id]["name"], "我的图片预设")
        self.assertEqual(saved["vision_presets"][preset_id]["IMAGE_ANALYSIS_NAME"], "我的图片预设")

    def test_icon_image_legacy_concurrency_limit_migrates_to_both_fields(self):
        self.config_path.write_text(
            json.dumps(
                {
                    "settings_version": 2,
                    "global_config": {"DEBUG_MODE": False},
                    "text_presets": {"default": {"name": "默认文本模型", "OPENAI_BASE_URL": "", "OPENAI_MODEL": "gpt", "OPENAI_API_KEY": ""}},
                    "vision_presets": {"default": {"name": "默认图片模型", "IMAGE_ANALYSIS_NAME": "默认图片模型", "IMAGE_ANALYSIS_BASE_URL": "", "IMAGE_ANALYSIS_MODEL": "", "IMAGE_ANALYSIS_API_KEY": ""}},
                    "icon_image_presets": {
                        "default": {
                            "name": "默认图标生图",
                            "image_model": {"base_url": "", "model": "", "api_key": ""},
                            "image_size": "1024x1024",
                            "concurrency_limit": 3,
                            "save_mode": "centralized",
                        }
                    },
                    "active_text_preset_id": "default",
                    "active_vision_preset_id": "default",
                    "active_icon_image_preset_id": "default",
                    "bg_removal": {"mode": "preset", "preset_id": "bria-rmbg-2.0", "custom": {"name": "自定义抠图", "model_id": "", "api_type": "gradio_space", "payload_template": "", "hf_api_token": ""}},
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        service = SettingsService(
            config_path=self.config_path,
            legacy_icon_config_path=self.legacy_icon_path,
        )
        runtime = service.get_runtime_family_config("icon_image")
        saved = json.loads(self.config_path.read_text(encoding="utf-8"))

        self.assertEqual(runtime["analysis_concurrency_limit"], 3)
        self.assertEqual(runtime["image_concurrency_limit"], 3)
        self.assertEqual(saved["icon_image_presets"]["default"]["analysis_concurrency_limit"], 3)
        self.assertEqual(saved["icon_image_presets"]["default"]["image_concurrency_limit"], 3)

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

    def test_vision_defaults_to_shared_text_mode_when_mode_is_missing(self):
        self.config_path.write_text(
            json.dumps(
                {
                    "settings_version": 2,
                    "global_config": {"IMAGE_ANALYSIS_ENABLED": True},
                    "text_presets": {
                        "default": {
                            "name": "默认文本模型",
                            "OPENAI_BASE_URL": "https://text.example/v1",
                            "OPENAI_MODEL": "gpt-5.2",
                            "OPENAI_API_KEY": "text-secret",
                        }
                    },
                    "vision_presets": {
                        "default": {
                            "name": "默认图片模型",
                            "IMAGE_ANALYSIS_NAME": "默认图片模型",
                            "IMAGE_ANALYSIS_BASE_URL": "https://vision.example/v1",
                            "IMAGE_ANALYSIS_MODEL": "gpt-4.1-mini",
                            "IMAGE_ANALYSIS_API_KEY": "vision-secret",
                        }
                    },
                    "icon_image_presets": {},
                    "active_text_preset_id": "default",
                    "active_vision_preset_id": "default",
                    "active_icon_image_preset_id": "default",
                    "bg_removal": {"mode": "preset", "preset_id": "bria-rmbg-2.0", "custom": {"name": "自定义抠图", "model_id": "", "api_type": "gradio_space", "payload_template": "", "hf_api_token": ""}},
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        service = SettingsService(
            config_path=self.config_path,
            legacy_icon_config_path=self.legacy_icon_path,
        )
        runtime = service.get_runtime_family_config("vision")
        snapshot = service.get_settings_snapshot()
        saved = json.loads(self.config_path.read_text(encoding="utf-8"))

        self.assertEqual(snapshot["families"]["vision"]["mode"], "shared_text")
        self.assertEqual(runtime["mode"], "shared_text")
        self.assertEqual(runtime["base_url"], "https://text.example/v1")
        self.assertEqual(runtime["model"], "gpt-5.2")
        self.assertEqual(runtime["api_key"], "text-secret")
        self.assertEqual(saved["global_config"]["IMAGE_ANALYSIS_SOURCE_MODE"], "shared_text")

    def test_vision_shared_text_mode_tracks_text_configuration(self):
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
                        "mode": "shared_text",
                        "preset": {
                            "IMAGE_ANALYSIS_BASE_URL": "https://vision.example/v1",
                            "IMAGE_ANALYSIS_MODEL": "gpt-4.1-mini",
                        },
                        "secret": {"action": "replace", "value": "vision-secret"},
                    },
                }
            }
        )

        self.assertTrue(service.is_vision_configured())
        runtime = service.get_runtime_family_config("vision")
        self.assertEqual(runtime["mode"], "shared_text")
        self.assertEqual(runtime["base_url"], "https://text.example/v1")
        self.assertEqual(runtime["model"], "gpt-5.4")
        self.assertEqual(runtime["api_key"], "text-secret")

    def test_bg_removal_snapshot_masks_secret_and_exposes_builtin_presets(self):
        service = SettingsService(
            config_path=self.config_path,
            legacy_icon_config_path=self.legacy_icon_path,
        )

        service.update_settings(
            {
                "families": {
                    "bg_removal": {
                        "mode": "custom",
                        "custom": {
                            "name": "自定义抠图",
                            "model_id": "custom/space",
                            "api_type": "gradio_space",
                            "payload_template": '{"data":[{"path":"{{uploaded_path}}"}]}',
                        },
                        "secret": {"action": "replace", "value": "hf-secret"},
                    }
                }
            }
        )

        snapshot = service.get_settings_snapshot()
        serialized = json.dumps(snapshot, ensure_ascii=False)

        self.assertIn("bg_removal", snapshot["families"])
        self.assertEqual(snapshot["families"]["bg_removal"]["mode"], "custom")
        self.assertGreaterEqual(len(snapshot["families"]["bg_removal"]["builtin_presets"]), 4)
        self.assertEqual(snapshot["families"]["bg_removal"]["custom"]["secret_state"], "stored")
        self.assertNotIn("hf-secret", serialized)

    def test_bg_removal_runtime_returns_selected_builtin_and_custom_config(self):
        service = SettingsService(
            config_path=self.config_path,
            legacy_icon_config_path=self.legacy_icon_path,
        )

        service.update_settings(
            {
                "families": {
                    "bg_removal": {
                        "mode": "preset",
                        "preset": {"preset_id": "bria-rmbg-1.4"},
                    }
                }
            }
        )
        preset_runtime = service.get_runtime_family_config("bg_removal")
        self.assertEqual(preset_runtime["model_id"], "briaai/BRIA-RMBG-1.4")
        self.assertEqual(preset_runtime["api_type"], "gradio_space")

        service.update_settings(
            {
                "families": {
                    "bg_removal": {
                        "mode": "custom",
                        "custom": {
                            "name": "自定义抠图",
                            "model_id": "custom/rembg",
                            "api_type": "gradio_space",
                            "payload_template": '{"data":[{"path":"{{uploaded_path}}"}],"meta":"{{model_id}}"}',
                        },
                        "secret": {"action": "replace", "value": "custom-token"},
                    }
                }
            }
        )
        custom_runtime = service.get_runtime_family_config("bg_removal")
        self.assertEqual(custom_runtime["name"], "自定义抠图")
        self.assertEqual(custom_runtime["model_id"], "custom/rembg")
        self.assertEqual(custom_runtime["api_token"], "custom-token")
        self.assertIn("{{uploaded_path}}", custom_runtime["payload_template"])

    def test_bg_removal_missing_in_old_config_is_backfilled_on_load(self):
        self.config_path.write_text(
            json.dumps(
                {
                    "settings_version": 2,
                    "global_config": {"DEBUG_MODE": False},
                    "text_presets": {},
                    "vision_presets": {},
                    "icon_image_presets": {},
                    "active_text_preset_id": "default",
                    "active_vision_preset_id": "default",
                    "active_icon_image_preset_id": "default",
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        service = SettingsService(
            config_path=self.config_path,
            legacy_icon_config_path=self.legacy_icon_path,
        )
        snapshot = service.get_settings_snapshot()
        saved = json.loads(self.config_path.read_text(encoding="utf-8"))

        self.assertIn("bg_removal", snapshot["families"])
        self.assertIn("bg_removal", saved)
        self.assertEqual(saved["bg_removal"]["mode"], "preset")

    def test_fresh_install_without_config_is_unconfigured_and_empty(self):
        cleared_env = {
            "OPENAI_BASE_URL": "",
            "OPENAI_MODEL": "",
            "OPENAI_API_KEY": "",
            "OPENAI_ANALYSIS_MODEL": "",
            "OPENAI_ORGANIZER_MODEL": "",
            "IMAGE_ANALYSIS_NAME": "",
            "IMAGE_ANALYSIS_BASE_URL": "",
            "IMAGE_ANALYSIS_MODEL": "",
            "IMAGE_ANALYSIS_API_KEY": "",
            "IMAGE_ANALYSIS_ENABLED": "",
            "IMAGE_ANALYSIS_SOURCE_MODE": "",
        }
        with mock.patch.dict(os.environ, cleared_env, clear=False):
            for key in list(cleared_env):
                os.environ.pop(key, None)
            service = SettingsService(
                config_path=self.config_path,
                legacy_icon_config_path=self.legacy_icon_path,
            )
        snapshot = service.get_settings_snapshot()
        saved = json.loads(self.config_path.read_text(encoding="utf-8"))

        self.assertFalse(service.is_text_configured())
        self.assertFalse(service.is_vision_configured())
        self.assertFalse(snapshot["status"]["text_configured"])
        self.assertFalse(snapshot["status"]["vision_configured"])
        self.assertEqual(snapshot["families"]["vision"]["mode"], "shared_text")
        self.assertEqual(snapshot["families"]["text"]["active_preset"]["OPENAI_BASE_URL"], "")
        self.assertEqual(snapshot["families"]["text"]["active_preset"]["OPENAI_MODEL"], "")
        self.assertEqual(snapshot["families"]["text"]["active_preset"]["secret_state"], "empty")
        self.assertEqual(saved.get("text_presets"), {})
        self.assertEqual(saved.get("vision_presets"), {})
        self.assertEqual(saved.get("active_text_preset_id"), "")
        self.assertEqual(saved.get("active_vision_preset_id"), "")

    def test_example_placeholder_secrets_are_not_configured(self):
        self.config_path.write_text(
            json.dumps(
                {
                    "settings_version": 2,
                    "global_config": {
                        "IMAGE_ANALYSIS_ENABLED": False,
                        "IMAGE_ANALYSIS_SOURCE_MODE": "shared_text",
                    },
                    "text_presets": {
                        "default": {
                            "name": "默认文本模型",
                            "OPENAI_BASE_URL": "https://your-text-endpoint/v1",
                            "OPENAI_MODEL": "gpt-5.2",
                            "OPENAI_API_KEY": "your_text_api_key_here",
                        }
                    },
                    "vision_presets": {
                        "default": {
                            "name": "可选图片理解模型",
                            "IMAGE_ANALYSIS_NAME": "可选图片理解模型",
                            "IMAGE_ANALYSIS_BASE_URL": "https://your-vision-endpoint/v1",
                            "IMAGE_ANALYSIS_MODEL": "gpt-5.2",
                            "IMAGE_ANALYSIS_API_KEY": "your_vision_api_key_here",
                        }
                    },
                    "icon_image_presets": {},
                    "active_text_preset_id": "default",
                    "active_vision_preset_id": "default",
                    "active_icon_image_preset_id": "",
                    "bg_removal": {
                        "mode": "preset",
                        "preset_id": "bria-rmbg-2.0",
                        "custom": {
                            "name": "自定义抠图",
                            "model_id": "",
                            "api_type": "gradio_space",
                            "payload_template": "",
                            "hf_api_token": "",
                        },
                    },
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        service = SettingsService(
            config_path=self.config_path,
            legacy_icon_config_path=self.legacy_icon_path,
        )
        snapshot = service.get_settings_snapshot()
        saved = json.loads(self.config_path.read_text(encoding="utf-8"))

        self.assertFalse(service.is_text_configured())
        self.assertFalse(service.is_vision_configured())
        self.assertFalse(snapshot["status"]["text_configured"])
        self.assertFalse(snapshot["status"]["vision_configured"])
        self.assertEqual(snapshot["families"]["text"]["active_preset"]["secret_state"], "empty")
        self.assertEqual(snapshot["families"]["text"]["active_preset"]["OPENAI_BASE_URL"], "")
        self.assertEqual(snapshot["families"]["text"]["active_preset"]["OPENAI_MODEL"], "")
        self.assertEqual(saved.get("text_presets"), {})
        self.assertEqual(saved.get("vision_presets"), {})

    def test_real_credentials_still_mark_text_and_shared_vision_configured(self):
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
                        "secret": {"action": "replace", "value": "real-text-secret"},
                    },
                    "vision": {
                        "enabled": True,
                        "mode": "shared_text",
                    },
                }
            }
        )

        self.assertTrue(service.is_text_configured())
        self.assertTrue(service.is_vision_configured())
        snapshot = service.get_settings_snapshot()
        self.assertTrue(snapshot["status"]["text_configured"])
        self.assertTrue(snapshot["status"]["vision_configured"])
        self.assertEqual(snapshot["families"]["vision"]["mode"], "shared_text")


if __name__ == "__main__":
    unittest.main()
