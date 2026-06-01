import shutil
import time
import unittest
from pathlib import Path

from file_pilot.app.models import TaskState
from file_pilot.app.session_service import OrganizerSessionService
from file_pilot.app.session_store import SessionStore
from file_pilot.domain.models import OrganizeTask, TargetSlot


class TargetManagerTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_target_manager")
        if self.root.exists():
            shutil.rmtree(self.root, ignore_errors=True)
        self.target_dir = self.root / "Inbox"
        self.target_dir.mkdir(parents=True, exist_ok=True)
        self.store = SessionStore(self.root / "sessions")
        self.service = OrganizerSessionService(self.store)

    def tearDown(self):
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

    def test_initial_target_slots_prefer_task_state_over_snapshot(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.task_state = TaskState(
            targets=[
                TargetSlot(
                    slot_id="D009",
                    display_name="Task Docs",
                    real_path=str((self.target_dir / "TaskDocs").resolve()),
                    depth=0,
                    is_new=False,
                )
            ]
        )
        session.plan_snapshot = {
            "summary": "snapshot",
            "stats": {},
            "target_slots": [
                {
                    "slot_id": "D001",
                    "display_name": "Snapshot Docs",
                    "relpath": "SnapshotDocs",
                    "depth": 0,
                    "is_new": False,
                }
            ],
        }

        slots = self.service._target_slots_from_session(session)

        self.assertEqual([slot.slot_id for slot in slots], ["D009"])
        self.assertEqual(slots[0].display_name, "Task Docs")

    def test_initial_target_slots_rebuild_from_snapshot_payload(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.plan_snapshot = {
            "summary": "snapshot",
            "stats": {},
            "target_slots": [
                {
                    "slot_id": "D002",
                    "display_name": "Docs",
                    "relpath": "Docs",
                    "depth": 0,
                    "is_new": True,
                }
            ],
        }

        slots = self.service._target_slots_from_session(session)

        self.assertEqual([slot.slot_id for slot in slots], ["D002"])
        self.assertEqual(slots[0].real_path, str((self.target_dir / "Docs").resolve()))
        self.assertTrue(slots[0].is_new)

    def test_incremental_target_slots_include_nested_directory_tree(self):
        created = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            strategy={"organize_mode": "incremental", "destination_index_depth": 2},
        )
        session = created.session
        assert session is not None
        session.incremental_selection = {
            "required": True,
            "status": "ready",
            "destination_index_depth": 2,
            "root_directory_options": ["Projects"],
            "target_directories": ["Projects"],
            "target_directory_tree": [
                {
                    "relpath": "Projects",
                    "name": "Projects",
                    "children": [
                        {"relpath": "Projects/Active", "name": "Active", "children": []}
                    ],
                }
            ],
            "pending_items_count": 1,
            "source_scan_completed": True,
        }

        slots = self.service._target_slots_from_session(session)

        self.assertEqual([slot.slot_id for slot in slots], ["D001", "D002"])
        self.assertEqual([slot.display_name for slot in slots], ["Projects", "Active"])
        self.assertEqual([slot.depth for slot in slots], [0, 1])
        self.assertEqual(slots[0].children[0].slot_id, "D002")

    def test_target_slot_payloads_preserve_absolute_paths_outside_target_root(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        archive_dir = (self.root / "Archive" / "Docs").resolve()
        task = OrganizeTask(
            task_id=session.session_id,
            targets=[
                TargetSlot(
                    slot_id="D031",
                    display_name="Archive Docs",
                    real_path=str(archive_dir),
                    depth=1,
                    is_new=False,
                )
            ],
        )

        payloads = self.service._target_slot_payloads_from_task(session, task)

        self.assertEqual(payloads[0].slot_id, "D031")
        self.assertEqual(payloads[0].relpath, str(archive_dir))
        self.assertEqual(payloads[0].real_path, str(archive_dir))


if __name__ == "__main__":
    unittest.main()
