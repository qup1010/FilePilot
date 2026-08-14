import shutil
import sys
import unittest
from pathlib import Path

from file_pilot.execution import service as execution_service
from file_pilot.execution.movability import movability_skip_reason
from file_pilot.organize import service as organizer_service


class MovabilityTests(unittest.TestCase):
    def setUp(self):
        self.base_dir = Path("test_temp_movability")
        if self.base_dir.exists():
            shutil.rmtree(self.base_dir)
        self.base_dir.mkdir()

    def tearDown(self):
        if self.base_dir.exists():
            shutil.rmtree(self.base_dir)

    def test_downloading_suffix_is_not_movable(self):
        path = self.base_dir / "movie.mkv.crdownload"
        path.write_text("partial", encoding="utf-8")
        self.assertIsNotNone(movability_skip_reason(path))

    def test_plain_file_is_movable(self):
        path = self.base_dir / "done.pdf"
        path.write_text("done", encoding="utf-8")
        self.assertIsNone(movability_skip_reason(path))

    def test_directory_is_movable_by_default(self):
        path = self.base_dir / "folder"
        path.mkdir()
        self.assertIsNone(movability_skip_reason(path))

    @unittest.skipUnless(sys.platform == "win32", "文件占用探测依赖 Windows 共享语义")
    def test_locked_file_is_not_movable(self):
        path = self.base_dir / "locked.txt"
        path.write_text("locked", encoding="utf-8")
        with open(path, "r", encoding="utf-8"):
            reason = movability_skip_reason(path)
        self.assertIsNotNone(reason)
        self.assertIn("占用", reason)

    def test_precheck_skips_downloading_file(self):
        (self.base_dir / "a.txt.part").write_text("partial", encoding="utf-8")
        (self.base_dir / "b.txt").write_text("done", encoding="utf-8")
        parsed = organizer_service.parse_commands_block(
            '<COMMANDS>\n'
            'MKDIR "Docs"\n'
            'MOVE "a.txt.part" "Docs/a.txt.part"\n'
            'MOVE "b.txt" "Docs/b.txt"\n'
            '</COMMANDS>'
        )
        plan = execution_service.build_execution_plan(parsed, self.base_dir)

        precheck = execution_service.validate_execution_preconditions(plan)

        self.assertTrue(precheck.can_execute)
        not_movable = [skip for skip in precheck.item_skips if skip.reason == "not_movable"]
        self.assertEqual(len(not_movable), 1)
        self.assertIn("下载中", not_movable[0].message)

    def test_execute_plan_skips_downloading_file_at_runtime(self):
        (self.base_dir / "a.txt.part").write_text("partial", encoding="utf-8")
        parsed = organizer_service.parse_commands_block(
            '<COMMANDS>\nMKDIR "Docs"\nMOVE "a.txt.part" "Docs/a.txt.part"\n</COMMANDS>'
        )
        plan = execution_service.build_execution_plan(parsed, self.base_dir)

        report = execution_service.execute_plan(plan)

        self.assertEqual(report.skipped_count, 1)
        self.assertTrue((self.base_dir / "a.txt.part").exists())
