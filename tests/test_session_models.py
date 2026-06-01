import unittest

from file_pilot.app.id_registry import IdRegistry, IdRegistryState
from file_pilot.app.models import OrganizerSession, PlanSnapshotPayload
from file_pilot.domain.models import SourceRef, TargetSlot


class SessionModelTests(unittest.TestCase):
    def test_to_dict_backfills_nested_state_shapes(self):
        session = OrganizerSession(
            session_id="s1",
            target_dir="D:/workspace/Inbox",
            planner_items=[
                {
                    "planner_id": "F001",
                    "source_relpath": "md",
                    "display_name": "md",
                    "entry_type": "file",
                    "suggested_purpose": "学习资料",
                    "summary": "笔记",
                    "confidence": 0.9,
                    "ext": "md",
                }
            ],
            scanner_progress={"status": "completed"},
            planner_progress={"status": "idle"},
            messages=[{"role": "assistant", "content": "hello"}],
        )

        payload = session.to_dict()

        self.assertIn("task_state", payload)
        self.assertIn("conversation_state", payload)
        self.assertIn("execution_state", payload)
        self.assertEqual(payload["task_state"]["sources"][0]["ref_id"], "F001")
        self.assertEqual(payload["conversation_state"]["messages"][0]["content"], "hello")

    def test_from_dict_migrates_legacy_scan_lines_to_structured_sources(self):
        restored = OrganizerSession.from_dict(
            {
                "session_id": "legacy-1",
                "target_dir": "D:/workspace/Inbox",
                "stage": "planning",
                "scan_lines": "plan.md | file | 技术设计 | 架构设计文档",
                "planner_items": [],
                "task_state": {"sources": [], "targets": [], "mappings": [], "strategy": {}, "phase": "planning"},
            }
        )

        self.assertEqual(restored.planner_items[0]["planner_id"], "F001")
        self.assertEqual(restored.planner_items[0]["source_relpath"], "plan.md")
        self.assertIsNotNone(restored.task_state)
        assert restored.task_state is not None
        self.assertEqual(restored.task_state.sources[0].ref_id, "F001")
        self.assertEqual(restored.task_state.sources[0].content_summary, "架构设计文档")

    def test_from_dict_does_not_migrate_incremental_discovery_scan_lines(self):
        restored = OrganizerSession.from_dict(
            {
                "session_id": "legacy-2",
                "target_dir": "D:/workspace/Inbox",
                "stage": "selecting_incremental_scope",
                "organize_mode": "incremental",
                "scan_lines": "Projects | dir | 项目目录 | 既有目标",
                "planner_items": [],
                "incremental_selection": {
                    "required": True,
                    "status": "pending",
                    "source_scan_completed": False,
                },
            }
        )

        self.assertEqual(restored.planner_items, [])
        self.assertIsNone(restored.task_state)

    def test_from_dict_migrates_legacy_incremental_ready_scan_lines_without_completion_flag(self):
        restored = OrganizerSession.from_dict(
            {
                "session_id": "legacy-3",
                "target_dir": "D:/workspace/Inbox",
                "stage": "planning",
                "organize_mode": "incremental",
                "scan_lines": "todo.txt | file | 待处理 | 待整理",
                "planner_items": [],
                "incremental_selection": {
                    "required": True,
                    "status": "ready",
                    "target_directories": ["Projects"],
                },
                "task_state": {"sources": [], "targets": [], "mappings": [], "strategy": {}, "phase": "planning"},
            }
        )

        self.assertEqual(restored.planner_items[0]["source_relpath"], "todo.txt")
        self.assertIsNotNone(restored.task_state)
        assert restored.task_state is not None
        self.assertEqual(restored.task_state.sources[0].ref_id, "F001")

    def test_from_dict_migrates_existing_planner_items_to_task_sources_without_scan_lines(self):
        restored = OrganizerSession.from_dict(
            {
                "session_id": "legacy-4",
                "target_dir": "D:/workspace/Inbox",
                "stage": "planning",
                "scan_lines": "",
                "planner_items": [
                    {
                        "planner_id": "F009",
                        "source_relpath": "docs/plan.md",
                        "display_name": "plan.md",
                        "summary": "架构设计文档",
                    }
                ],
                "task_state": {"sources": [], "targets": [], "mappings": [], "strategy": {}, "phase": "planning"},
            }
        )

        self.assertIsNotNone(restored.task_state)
        assert restored.task_state is not None
        self.assertEqual(restored.task_state.sources[0].ref_id, "F009")
        self.assertEqual(restored.task_state.sources[0].relpath, "docs/plan.md")

    def test_id_registry_state_roundtrips_with_session_payload(self):
        session = OrganizerSession(
            session_id="s1",
            target_dir="D:/workspace/Inbox",
            id_registry_state=IdRegistryState(
                source_ids_by_relpath={"a.txt": "F007"},
                target_ids_by_real_path={"D:/workspace/Inbox/Docs": "D009"},
                next_source_number=8,
                next_target_number=10,
            ),
        )

        restored = OrganizerSession.from_dict(session.to_dict())

        self.assertIsNotNone(restored.id_registry_state)
        assert restored.id_registry_state is not None
        self.assertEqual(restored.id_registry_state.source_ids_by_relpath["a.txt"], "F007")
        self.assertEqual(restored.id_registry_state.target_ids_by_real_path["D:/workspace/Inbox/Docs"], "D009")
        self.assertEqual(restored.id_registry_state.next_source_number, 8)
        self.assertEqual(restored.id_registry_state.next_target_number, 10)

    def test_id_registry_preserves_existing_ids_and_appends_new_ids(self):
        registry = IdRegistry.from_state(
            IdRegistryState(
                source_ids_by_relpath={"old.txt": "F003"},
                target_ids_by_real_path={"D:/workspace/Inbox/Docs": "D004"},
                next_source_number=4,
                next_target_number=5,
            )
        )

        old_source = registry.register_source(
            SourceRef(
                ref_id="F001",
                display_name="old.txt",
                entry_type="file",
                origin="D:/workspace/Inbox",
                relpath="old.txt",
            )
        )
        new_source = registry.register_source(
            SourceRef(
                ref_id="F001",
                display_name="new.txt",
                entry_type="file",
                origin="D:/workspace/Inbox",
                relpath="new.txt",
            )
        )
        old_target = registry.register_target(
            TargetSlot(
                slot_id="D001",
                display_name="Docs",
                real_path="D:/workspace/Inbox/Docs",
            )
        )
        new_target = registry.ensure_target(
            display_name="Images",
            real_path="D:/workspace/Inbox/Images",
        )

        self.assertEqual(old_source.ref_id, "F003")
        self.assertEqual(new_source.ref_id, "F004")
        self.assertEqual(old_target.slot_id, "D004")
        self.assertEqual(new_target.slot_id, "D005")

        state = registry.to_state()
        self.assertEqual(state.source_ids_by_relpath["old.txt"], "F003")
        self.assertEqual(state.source_ids_by_relpath["new.txt"], "F004")
        self.assertEqual(state.target_ids_by_real_path["D:/workspace/Inbox/Docs"], "D004")
        self.assertEqual(state.target_ids_by_real_path["D:/workspace/Inbox/Images"], "D005")

    def test_plan_target_slot_payload_derives_review_semantics_for_legacy_payload(self):
        snapshot = PlanSnapshotPayload.from_dict(
            {
                "summary": "snapshot",
                "stats": {},
                "target_slots": [
                    {
                        "slot_id": "Review",
                        "display_name": "待确认区",
                        "relpath": "Review",
                        "depth": 0,
                        "is_new": False,
                    }
                ],
            }
        )

        assert snapshot is not None
        self.assertEqual(snapshot.target_slots[0].kind, "review")
        self.assertTrue(snapshot.target_slots[0].is_review)
        self.assertEqual(snapshot.to_dict()["target_slots"][0]["kind"], "review")
        self.assertTrue(snapshot.to_dict()["target_slots"][0]["is_review"])


if __name__ == "__main__":
    unittest.main()
