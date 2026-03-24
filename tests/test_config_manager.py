import json
import os
import shutil
import unittest
from pathlib import Path
from unittest import mock

from file_organizer.shared import config_manager as config_module


class ConfigManagerSecretPersistenceTests(unittest.TestCase):
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

    def test_sync_from_legacy_env_does_not_persist_secret_values_to_config_json(self):
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
        profile = payload["profiles"][payload["active_profile_id"]]

        self.assertNotIn("OPENAI_API_KEY", profile)
        self.assertNotIn("IMAGE_ANALYSIS_API_KEY", profile)
        self.assertEqual(profile["OPENAI_BASE_URL"], "https://example.invalid/v1")
        self.assertTrue(profile["IMAGE_ANALYSIS_ENABLED"])
        self.assertEqual(manager.get("OPENAI_API_KEY"), "test-openai-secret")
        self.assertEqual(manager.get("IMAGE_ANALYSIS_API_KEY"), "test-image-secret")

    def test_update_active_profile_keeps_secret_in_runtime_but_not_on_disk(self):
        manager = config_module.ConfigManager()

        manager.update_active_profile(
            {
                "OPENAI_API_KEY": "runtime-openai-secret",
                "IMAGE_ANALYSIS_API_KEY": "runtime-image-secret",
                "OPENAI_BASE_URL": "https://runtime.invalid/v1",
                "DEBUG_MODE": True,
            }
        )

        payload = json.loads(self.config_path.read_text(encoding="utf-8"))
        profile = payload["profiles"][payload["active_profile_id"]]

        self.assertNotIn("OPENAI_API_KEY", profile)
        self.assertNotIn("IMAGE_ANALYSIS_API_KEY", profile)
        self.assertEqual(profile["OPENAI_BASE_URL"], "https://runtime.invalid/v1")
        self.assertTrue(profile["DEBUG_MODE"])
        self.assertEqual(manager.get("OPENAI_API_KEY"), "runtime-openai-secret")
        self.assertEqual(manager.get("IMAGE_ANALYSIS_API_KEY"), "runtime-image-secret")

    def test_existing_config_keeps_runtime_secret_from_environment(self):
        self.config_path.write_text(
            json.dumps(
                {
                    "active_profile_id": "default",
                    "profiles": {
                        "default": {
                            "name": "默认配置",
                            "OPENAI_BASE_URL": "https://persisted.invalid/v1",
                            "OPENAI_MODEL": "persisted-model"
                        }
                    },
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        with mock.patch.dict(
            os.environ,
            {
                "OPENAI_API_KEY": "env-openai-secret",
                "IMAGE_ANALYSIS_API_KEY": "env-image-secret",
            },
            clear=False,
        ):
            manager = config_module.ConfigManager()

        active = manager.get_active_config(mask_secrets=False)
        self.assertEqual(active["OPENAI_API_KEY"], "env-openai-secret")
        self.assertEqual(active["IMAGE_ANALYSIS_API_KEY"], "env-image-secret")
        self.assertEqual(active["OPENAI_BASE_URL"], "https://persisted.invalid/v1")
        self.assertEqual(active["OPENAI_MODEL"], "persisted-model")

    def test_load_from_file_migrates_legacy_openai_analysis_model(self):
        self.config_path.write_text(
            json.dumps(
                {
                    "active_profile_id": "default",
                    "profiles": {
                        "default": {
                            "name": "默认配置",
                            "OPENAI_BASE_URL": "https://legacy.invalid/v1",
                            "OPENAI_ANALYSIS_MODEL": "legacy-analysis-model",
                        }
                    },
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        manager = config_module.ConfigManager()

        active = manager.get_active_config(mask_secrets=False)
        payload = json.loads(self.config_path.read_text(encoding="utf-8"))
        profile = payload["profiles"][payload["active_profile_id"]]

        self.assertEqual(active["OPENAI_MODEL"], "legacy-analysis-model")
        self.assertEqual(profile["OPENAI_MODEL"], "legacy-analysis-model")
        self.assertNotIn("OPENAI_ANALYSIS_MODEL", profile)

    def test_update_active_profile_ignores_unknown_keys(self):
        manager = config_module.ConfigManager()

        manager.update_active_profile({
            "OPENAI_BASE_URL": "https://allowed.invalid/v1",
            "UNEXPECTED_KEY": "boom",
        })

        active = manager.get_active_config(mask_secrets=False)
        payload = json.loads(self.config_path.read_text(encoding="utf-8"))
        profile = payload["profiles"][payload["active_profile_id"]]

        self.assertEqual(active["OPENAI_BASE_URL"], "https://allowed.invalid/v1")
        self.assertNotIn("UNEXPECTED_KEY", active)
        self.assertNotIn("UNEXPECTED_KEY", profile)
        self.assertNotIn("UNEXPECTED_KEY", os.environ)

    def test_update_active_profile_allows_clearing_secret_fields(self):
        manager = config_module.ConfigManager()
        manager.update_active_profile(
            {
                "OPENAI_API_KEY": "runtime-openai-secret",
                "IMAGE_ANALYSIS_API_KEY": "runtime-image-secret",
            }
        )

        manager.update_active_profile(
            {
                "OPENAI_API_KEY": "",
                "IMAGE_ANALYSIS_API_KEY": "",
            }
        )

        active = manager.get_active_config(mask_secrets=False)

        self.assertEqual(active["OPENAI_API_KEY"], "")
        self.assertEqual(active["IMAGE_ANALYSIS_API_KEY"], "")
        self.assertEqual(os.environ.get("OPENAI_API_KEY"), "")
        self.assertEqual(os.environ.get("IMAGE_ANALYSIS_API_KEY"), "")

    def test_switch_profile_does_not_inherit_previous_profile_runtime_secret(self):
        manager = config_module.ConfigManager()
        manager.update_active_profile({"OPENAI_API_KEY": "default-secret"})
        new_id = manager.add_profile("empty-profile", copy_from_active=False)

        manager.switch_profile(new_id)

        active = manager.get_active_config(mask_secrets=False)
        self.assertEqual(active["OPENAI_API_KEY"], "")
        self.assertEqual(os.environ.get("OPENAI_API_KEY"), "")


if __name__ == "__main__":
    unittest.main()
