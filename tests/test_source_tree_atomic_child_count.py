from __future__ import annotations

import shutil
import unittest
from pathlib import Path

from file_pilot.app.session_service import OrganizerSessionService
from file_pilot.app.session_store import SessionStore


class AtomicChildCountTest(unittest.TestCase):
    """整体移动的目录在计划里只占 1 项，需要把内部条目数带给前端做提示。"""

    def setUp(self) -> None:
        # 安全校验会拒绝系统临时目录作为来源，这里沿用既有测试的仓库内相对目录。
        self.root = Path("test_temp_atomic_child_count")
        if self.root.exists():
            shutil.rmtree(self.root)
        self.target_dir = self.root / "target"
        self.target_dir.mkdir(parents=True, exist_ok=True)
        self.sources_dir = self.root / "sources"
        self.sources_dir.mkdir(parents=True, exist_ok=True)
        self.service = OrganizerSessionService(SessionStore(self.root / "sessions"))

    def tearDown(self) -> None:
        if self.root.exists():
            shutil.rmtree(self.root, ignore_errors=True)

    def _create_atomic_session(self, source_dir: Path):
        created = self.service.create_session(
            [{"source_type": "directory", "path": str(source_dir), "directory_mode": "atomic"}],
            resume_if_exists=False,
            organize_method="categorize_into_new_structure",
            strategy={"template_id": "general_downloads"},
            output_dir=str(self.target_dir),
        )
        session = created.session
        assert session is not None
        return session

    def test_atomic_directory_entry_reports_child_count(self) -> None:
        source_dir = self.sources_dir / "backup"
        (source_dir / "nested").mkdir(parents=True, exist_ok=True)
        session = self._create_atomic_session(source_dir)

        scan_lines = "\n".join(
            [
                "backup | dir | 备份 | 备份目录",
                "backup/a.txt | file | 资料 | 文件 A",
                "backup/b.txt | file | 资料 | 文件 B",
                "backup/nested/c.txt | file | 资料 | 文件 C",
            ]
        )

        entries = self.service.source_manager.build_source_tree_entries(
            self.target_dir,
            scan_lines,
            session=session,
        )

        atomic_entries = [entry for entry in entries if entry.get("source_mode") == "atomic"]
        self.assertEqual(len(atomic_entries), 1, f"expected one atomic root, got {entries}")
        self.assertEqual(atomic_entries[0]["child_count"], 3)
        # 子孙条目仍应被折叠，不单独出现在树里。
        self.assertNotIn("backup/a.txt", {entry["source_relpath"] for entry in entries})

    def test_atomic_directory_without_children_omits_child_count(self) -> None:
        source_dir = self.sources_dir / "empty-backup"
        source_dir.mkdir(parents=True, exist_ok=True)
        session = self._create_atomic_session(source_dir)

        entries = self.service.source_manager.build_source_tree_entries(
            self.target_dir,
            "empty-backup | dir | 备份 | 空目录",
            session=session,
        )

        atomic_entries = [entry for entry in entries if entry.get("source_mode") == "atomic"]
        self.assertEqual(len(atomic_entries), 1)
        self.assertNotIn("child_count", atomic_entries[0])


if __name__ == "__main__":
    unittest.main()
