import shutil
import unittest
from pathlib import Path
from unittest import mock

from file_pilot.analysis import service as analysis_service


class AnalysisPathBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_analysis_boundaries")
        if self.root.exists():
            shutil.rmtree(self.root)
        self.root.mkdir()
        self.target_dir = self.root / "Inbox"
        self.target_dir.mkdir()
        (self.target_dir / "inside.txt").write_text("inside", encoding="utf-8")
        self.outside_file = self.root / "outside.txt"
        self.outside_file.write_text("outside", encoding="utf-8")

    def tearDown(self):
        if self.root.exists():
            shutil.rmtree(self.root)

    def test_dispatch_tool_call_rejects_read_local_file_parent_traversal(self):
        with mock.patch.object(analysis_service, "read_local_file", return_value="should-not-read") as read_local_file:
            result = analysis_service._dispatch_tool_call(
                self.target_dir,
                "read_local_file",
                {"filename": "../outside.txt"},
            )

        self.assertIn("错误", result)
        read_local_file.assert_not_called()

    def test_dispatch_tool_call_rejects_read_local_file_absolute_path_outside_target_dir(self):
        with mock.patch.object(analysis_service, "read_local_file", return_value="should-not-read") as read_local_file:
            result = analysis_service._dispatch_tool_call(
                self.target_dir,
                "read_local_file",
                {"filename": str(self.outside_file.resolve())},
            )

        self.assertIn("错误", result)
        read_local_file.assert_not_called()


if __name__ == "__main__":
    unittest.main()
