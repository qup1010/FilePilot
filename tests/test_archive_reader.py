import shutil
import unittest
import zipfile
from pathlib import Path

from file_pilot.analysis.archive_reader import read_archive_index


class ArchiveReaderTests(unittest.TestCase):
    def setUp(self):
        self.root_dir = Path("test_temp_archive_reader")
        if self.root_dir.exists():
            shutil.rmtree(self.root_dir)
        self.root_dir.mkdir()
        self.archive_path = self.root_dir / "bundle.zip"

        with zipfile.ZipFile(self.archive_path, "w") as archive:
            archive.writestr("docs/readme.md", "hello")
            archive.writestr("docs/specs/plan.txt", "world")
            archive.writestr("images/cover.png", "png-bytes")
            archive.writestr("notes/todo.txt", "todo")
            archive.writestr("notes/archive/old.txt", "old")

    def tearDown(self):
        if self.root_dir.exists():
            shutil.rmtree(self.root_dir)

    def test_read_archive_index_lists_zip_entries_without_extracting(self):
        result = read_archive_index(self.archive_path)

        self.assertIn("bundle.zip", result)
        self.assertIn("docs/readme.md", result)
        self.assertIn("images/cover.png", result)
        self.assertIn("文件数", result)

    def test_read_archive_index_truncates_long_listing(self):
        result = read_archive_index(self.archive_path, max_entries=2)

        self.assertIn("其余", result)
        self.assertIn("已省略", result)


if __name__ == "__main__":
    unittest.main()
