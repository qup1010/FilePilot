import os
import unittest
from pathlib import Path
from importlib import reload

from file_pilot.shared import constants
from file_pilot.shared import config as config_module


class RuntimePathTests(unittest.TestCase):
    def test_resolve_project_root_prefers_environment_override(self):
        previous = os.environ.get("FILE_PILOT_PROJECT_ROOT")
        temp_dir = Path("output/test_runtime_root").resolve()
        temp_dir.mkdir(parents=True, exist_ok=True)
        os.environ["FILE_PILOT_PROJECT_ROOT"] = str(temp_dir)
        self.assertEqual(constants.resolve_project_root(), temp_dir)

        if previous is None:
            os.environ.pop("FILE_PILOT_PROJECT_ROOT", None)
        else:
            os.environ["FILE_PILOT_PROJECT_ROOT"] = previous

    def test_config_uses_environment_override_for_sessions_dir(self):
        previous = os.environ.get("FILE_PILOT_PROJECT_ROOT")
        temp_dir = Path("output/test_runtime_root_config").resolve()
        temp_dir.mkdir(parents=True, exist_ok=True)
        os.environ["FILE_PILOT_PROJECT_ROOT"] = str(temp_dir)

        try:
            reload(constants)
            reloaded_config = reload(config_module)
            self.assertEqual(reloaded_config.OUTPUT_DIR, temp_dir / "output")
            self.assertEqual(reloaded_config.SESSIONS_DIR, temp_dir / "output" / "sessions")
        finally:
            if previous is None:
                os.environ.pop("FILE_PILOT_PROJECT_ROOT", None)
            else:
                os.environ["FILE_PILOT_PROJECT_ROOT"] = previous
            reload(constants)
            reload(config_module)


if __name__ == "__main__":
    unittest.main()
