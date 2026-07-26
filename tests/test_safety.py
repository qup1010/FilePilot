import os
import unittest
from pathlib import Path
from unittest import mock

from file_pilot.app.safety import (
    RISKY_MOVE_CROSS_VOLUME,
    RISKY_MOVE_HIDDEN_ENTRY,
    RISKY_MOVE_PROJECT_ENTRY,
    risky_move_reason,
    unsafe_source_path_reason,
)


class RiskyMoveReasonTests(unittest.TestCase):
    def test_flags_sensitive_directory_component(self):
        self.assertEqual(risky_move_reason("project/node_modules/pkg", "Archive/pkg"), RISKY_MOVE_PROJECT_ENTRY)
        self.assertEqual(risky_move_reason("repo/.git", "Archive/.git"), RISKY_MOVE_PROJECT_ENTRY)

    def test_flags_project_marker_basename(self):
        self.assertEqual(risky_move_reason("app/package-lock.json", "Docs/package-lock.json"), RISKY_MOVE_PROJECT_ENTRY)
        self.assertEqual(risky_move_reason("app/pyproject.toml", "Docs/pyproject.toml"), RISKY_MOVE_PROJECT_ENTRY)

    def test_flags_hidden_entry_anywhere_in_path(self):
        self.assertEqual(risky_move_reason(".hidden.txt", "Docs/.hidden.txt"), RISKY_MOVE_HIDDEN_ENTRY)
        self.assertEqual(risky_move_reason("foo/.config/settings.json", "Docs/settings.json"), RISKY_MOVE_HIDDEN_ENTRY)

    def test_drive_anchor_is_not_treated_as_hidden(self):
        self.assertIsNone(risky_move_reason("d:/downloads/report.pdf", "d:/archive/report.pdf"))

    def test_flags_cross_volume_move(self):
        self.assertEqual(risky_move_reason("d:/downloads/report.pdf", "e:/archive/report.pdf"), RISKY_MOVE_CROSS_VOLUME)

    def test_deep_relative_path_is_not_risky_by_itself(self):
        # 层级深浅与风险无因果关系，深路径不应告警
        self.assertIsNone(risky_move_reason("2024/照片/旅行/日本/大阪/图1.jpg", "Docs/图1.jpg"))

    def test_normal_move_returns_none(self):
        self.assertIsNone(risky_move_reason("downloads/report.pdf", "Docs/report.pdf"))
        self.assertIsNone(risky_move_reason("", ""))


class UnsafeSourcePathReasonTests(unittest.TestCase):
    def test_blocks_drive_root(self):
        drive = Path.cwd().drive or "C:"
        self.assertEqual(unsafe_source_path_reason(f"{drive}/"), "SOURCE_PATH_DRIVE_ROOT")

    def test_blocks_project_root_directory_source(self):
        self.assertEqual(unsafe_source_path_reason(Path.cwd(), source_type="directory"), "SOURCE_PATH_PROJECT_ROOT")

    def test_blocks_windows_system_directories(self):
        system_root = os.environ.get("SystemRoot", "").strip()
        if not system_root:
            self.skipTest("SystemRoot 未设置")
        self.assertEqual(
            unsafe_source_path_reason(Path(system_root) / "System32"),
            "SOURCE_PATH_SYSTEM_PROTECTED",
        )

    def test_allows_ordinary_directory(self):
        with mock.patch.dict(os.environ, {"USERPROFILE": ""}, clear=False):
            self.assertIsNone(unsafe_source_path_reason(Path.cwd() / "some" / "ordinary" / "dir"))


if __name__ == "__main__":
    unittest.main()
