import shutil
import time
import unittest
from pathlib import Path
from unittest import mock

from file_pilot.app.session_service import OrganizerSessionService
from file_pilot.app.session_store import SessionStore
from file_pilot.organize.models import PendingPlan, PlanMove
from file_pilot.shared.logging_utils import close_backend_logging


class UnattendedPipelineTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_unattended")
        if self.root.exists():
            shutil.rmtree(self.root, ignore_errors=True)
        self.source_dir = self.root / "Downloads"
        self.docs_dir = self.root / "Archive" / "Docs"
        self.source_dir.mkdir(parents=True, exist_ok=True)
        self.docs_dir.mkdir(parents=True, exist_ok=True)
        self.store = SessionStore(self.root / "sessions")
        self.service = OrganizerSessionService(self.store)

    def tearDown(self):
        close_backend_logging()
        if self.root.exists():
            last_error = None
            for _ in range(5):
                try:
                    shutil.rmtree(self.root)
                    return
                except PermissionError as exc:
                    last_error = exc
                    time.sleep(0.1)
            if last_error is not None:
                raise last_error

    def _directory_details(self, description: str = "PDF 技术手册与说明文档"):
        return [{"path": str(self.docs_dir.resolve()), "label": "文档", "description": description}]

    def test_unattended_requires_existing_categories_method(self):
        with self.assertRaises(ValueError) as ctx:
            self.service.create_session(
                str(self.source_dir),
                resume_if_exists=False,
                organize_method="categorize_into_new_structure",
                output_dir=str(self.source_dir),
                unattended=True,
            )
        self.assertEqual(str(ctx.exception), "UNATTENDED_REQUIRES_EXISTING_CATEGORIES")

    def test_unattended_blocks_when_rules_missing(self):
        with self.assertRaises(ValueError) as ctx:
            self.service.create_session(
                str(self.source_dir),
                resume_if_exists=False,
                organize_method="assign_into_existing_categories",
                strategy={"organize_mode": "incremental"},
                target_directory_details=self._directory_details(description=""),
                unattended=True,
            )
        self.assertEqual(str(ctx.exception), "TARGET_RULES_INCOMPLETE")

    def test_unattended_session_persists_flag(self):
        created = self.service.create_session(
            str(self.source_dir),
            resume_if_exists=False,
            organize_method="assign_into_existing_categories",
            strategy={"organize_mode": "incremental"},
            target_directory_details=self._directory_details(),
            unattended=True,
        )
        session = created.session
        assert session is not None
        self.assertTrue(session.unattended)
        reloaded = self.store.load(session.session_id)
        assert reloaded is not None
        self.assertTrue(reloaded.unattended)

    def test_attended_session_defaults_to_not_unattended(self):
        created = self.service.create_session(
            str(self.source_dir),
            resume_if_exists=False,
            organize_method="assign_into_existing_categories",
            strategy={"organize_mode": "incremental"},
            target_directory_details=self._directory_details(),
        )
        session = created.session
        assert session is not None
        self.assertFalse(session.unattended)

    def test_unattended_pipeline_scans_plans_and_executes_to_completion(self):
        (self.source_dir / "manual.pdf").write_text("pdf", encoding="utf-8")
        (self.source_dir / "mystery.bin").write_text("???", encoding="utf-8")
        created = self.service.create_session(
            str(self.source_dir),
            resume_if_exists=False,
            organize_method="assign_into_existing_categories",
            strategy={"organize_mode": "incremental"},
            target_directory_details=self._directory_details(),
            unattended=True,
        )
        session = created.session
        assert session is not None

        docs_relpath = self.docs_dir.resolve().as_posix()
        plan = PendingPlan(
            moves=[
                PlanMove(source="manual.pdf", target=f"{docs_relpath}/manual.pdf"),
                PlanMove(source="mystery.bin", target="Review/mystery.bin"),
            ],
            unresolved_items=["mystery.bin"],
            summary="1 项归位，1 项待补规则",
        )

        with mock.patch(
            "file_pilot.app.session_orchestrator.organize_service.run_organizer_cycle",
            return_value=(
                "一键整理完成",
                {
                    "pending_plan": plan,
                    "assistant_message": {"role": "assistant", "content": "一键整理完成"},
                },
            ),
        ):
            self.service.start_scan(
                session.session_id,
                scan_runner=lambda path: "manual.pdf | file | PDF 手册 | 手册\nmystery.bin | file | 未知文件 | 未知",
            )

        reloaded = self.store.load(session.session_id)
        assert reloaded is not None
        # 一键：扫描→规划→预检→执行全程自动，最终完成
        self.assertEqual(reloaded.stage, "completed")
        # 高置信项已归位
        self.assertTrue((self.docs_dir / "manual.pdf").exists())
        self.assertFalse((self.source_dir / "manual.pdf").exists())
        # 拿不准的留在原地，且没有生成物理待确认区
        self.assertTrue((self.source_dir / "mystery.bin").exists())
        self.assertFalse((self.source_dir / "Review").exists())
        # journal 携带执行时刻的规则快照
        from file_pilot.execution.service import load_execution_journal

        assert reloaded.last_journal_id is not None
        journal = load_execution_journal(reloaded.last_journal_id)
        assert journal is not None
        self.assertIsNotNone(journal.rule_snapshot)
        self.assertTrue(journal.rule_snapshot["unattended"])
        self.assertEqual(
            journal.rule_snapshot["directories"][0]["description"],
            "PDF 技术手册与说明文档",
        )
