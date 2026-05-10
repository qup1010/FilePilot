import shutil
import unittest
from pathlib import Path

from file_pilot.app.id_registry import IdRegistry
from file_pilot.app.session_service import OrganizerSessionService
from file_pilot.app.session_store import SessionStore
from file_pilot.domain.models import SourceRef, TargetSlot
from file_pilot.organize.models import PendingPlan, PlanMove


class DomainArchitectureTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_domain_architecture")
        if self.root.exists():
            shutil.rmtree(self.root, ignore_errors=True)
        self.target_dir = self.root / "Inbox"
        self.target_dir.mkdir(parents=True, exist_ok=True)
        self.store = SessionStore(self.root / "sessions")
        self.service = OrganizerSessionService(self.store)

    def tearDown(self):
        if self.root.exists():
            shutil.rmtree(self.root, ignore_errors=True)

    def test_id_registry_registers_and_resolves_paths(self):
        registry = IdRegistry()
        source = registry.register_source(
            SourceRef(
                ref_id="F001",
                display_name="report.pdf",
                entry_type="file",
                origin="D:/Downloads",
                relpath="report.pdf",
            )
        )
        target = registry.register_target(
            TargetSlot(
                slot_id="D001",
                display_name="文档",
                real_path="D:/Library/文档",
            )
        )

        self.assertEqual(registry.resolve_source(source.ref_id).as_posix(), "D:/Downloads/report.pdf")
        self.assertEqual(registry.resolve_target(target.slot_id, "report.pdf").as_posix(), "D:/Library/文档/report.pdf")

    def test_build_organize_task_adapts_existing_session_state(self):
        created = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            strategy={"organize_mode": "incremental", "destination_index_depth": 2},
        )
        session = created.session
        assert session is not None
        (self.target_dir / "Docs").mkdir()
        (self.target_dir / "invoice.pdf").write_text("hello", encoding="utf-8")

        session.stage = "planning"
        session.scan_lines = "invoice.pdf | file | 财务票据 | 发票"
        session.planner_items = [
            {
                "planner_id": "F001",
                "source_relpath": "invoice.pdf",
                "display_name": "invoice.pdf",
                "suggested_purpose": "财务票据",
                "summary": "发票",
                "entry_type": "file",
                "ext": "pdf",
                "parent_hint": "",
            }
        ]
        session.incremental_selection = {
            "required": True,
            "status": "ready",
            "root_directory_options": ["Docs"],
            "target_directories": ["Docs"],
            "target_directory_tree": [
                {
                    "relpath": "Docs",
                    "name": "Docs",
                    "children": [],
                }
            ],
            "pending_items_count": 1,
            "source_scan_completed": True,
        }
        pending_plan = PendingPlan(
            moves=[PlanMove(source="invoice.pdf", target="Docs/invoice.pdf")],
            unresolved_items=[],
            summary="已分类 1 项，调整 1 项，仍剩 0 项待定",
        )

        task, registry = self.service._build_organize_task(session, pending_plan)

        self.assertEqual(task.task_id, session.session_id)
        self.assertEqual([item.ref_id for item in task.sources], ["F001"])
        self.assertEqual([item.display_name for item in task.targets], ["Docs"])
        self.assertEqual(len(task.mappings), 1)
        self.assertEqual(task.mappings[0].source_ref_id, "F001")
        self.assertTrue(task.mappings[0].target_slot_id.startswith("D"))
        self.assertEqual(
            registry.resolve_target(task.mappings[0].target_slot_id, "invoice.pdf").relative_to(self.target_dir.resolve()).as_posix(),
            "Docs/invoice.pdf",
        )


if __name__ == "__main__":
    unittest.main()
