import shutil
import time
import unittest
import json
from pathlib import Path
from unittest import mock

from file_pilot.app.models import OrganizerSession, PendingPlanPayload, PlanSnapshotPayload, SourceCollectionItem, TaskState
from file_pilot.app.session_service import OrganizerSessionService
from file_pilot.app.session_store import SessionStore
from file_pilot.organize.models import PendingPlan, PlanMove
from file_pilot.shared.logging_utils import close_backend_logging, setup_backend_logging


class ImmediateScanner:
    def start(self, session_id, target_dir, run_scan, on_complete, on_error):
        try:
            on_complete(session_id, run_scan(target_dir))
        except Exception as exc:
            on_error(session_id, exc)

    def get_progress(self, session_id):
        return {"running": False}


class OrganizerSessionServiceTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_session_service")
        if self.root.exists():
            shutil.rmtree(self.root, ignore_errors=True)
        self.target_dir = self.root / "Inbox"
        self.target_dir.mkdir(parents=True, exist_ok=True)
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

    @staticmethod
    def _plan_item_target_directory(snapshot: dict, source_relpath: str) -> str:
        plan = snapshot["plan_snapshot"]
        item = next(entry for entry in plan["items"] if entry["source_relpath"] == source_relpath)
        slot_id = str(item.get("target_slot_id") or "")
        if slot_id == "Review" or item.get("status") == "review":
            return "Review"
        if not slot_id:
            return ""
        slot = next((entry for entry in plan.get("target_slots", []) if entry.get("slot_id") == slot_id), None)
        return str(slot.get("relpath") or "") if slot else ""

    def _plan_item_target_path(self, snapshot: dict, source_relpath: str) -> str:
        directory = self._plan_item_target_directory(snapshot, source_relpath)
        filename = source_relpath.replace("\\", "/").split("/")[-1]
        return f"{directory}/{filename}" if directory else filename

    def test_create_session_returns_created_mode(self):
        result = self.service.create_session(str(self.target_dir), resume_if_exists=False)

        self.assertEqual(result.mode, "created")
        self.assertEqual(result.session.stage, "draft")
        self.assertIsNone(result.restorable_session)

    def test_create_session_returns_resume_available_when_session_exists(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        self.store.save(created.session)

        resumed = self.service.create_session(str(self.target_dir), resume_if_exists=True)

        self.assertEqual(resumed.mode, "resume_available")
        self.assertIsNotNone(resumed.restorable_session)
        self.assertEqual(resumed.restorable_session.session_id, created.session.session_id)

    def test_build_id_registry_persists_legacy_scan_line_ids(self):
        session = OrganizerSession(
            session_id="legacy-session",
            target_dir=str(self.target_dir),
            scan_lines="b.txt | file | | \na.txt | file | | ",
        )
        first_plan = PendingPlan(
            directories=["Docs"],
            moves=[
                PlanMove(source="b.txt", target="Docs/b.txt", raw=""),
                PlanMove(source="a.txt", target="Docs/a.txt", raw=""),
            ],
            user_constraints=[],
            unresolved_items=[],
            summary="",
        )

        first_registry = self.service._build_id_registry(session, first_plan)
        first_sources = {source.relpath: source.ref_id for source in first_registry.list_sources()}
        first_targets = {target.real_path.replace("\\", "/"): target.slot_id for target in first_registry.list_targets()}
        self.store.save(session)

        loaded = self.store.load(session.session_id)
        assert loaded is not None
        loaded.scan_lines = "a.txt | file | | \nb.txt | file | | \nc.txt | file | | "
        second_plan = PendingPlan(
            directories=["Docs", "Images"],
            moves=[
                PlanMove(source="a.txt", target="Docs/a.txt", raw=""),
                PlanMove(source="b.txt", target="Docs/b.txt", raw=""),
                PlanMove(source="c.txt", target="Images/c.txt", raw=""),
            ],
            user_constraints=[],
            unresolved_items=[],
            summary="",
        )

        second_registry = self.service._build_id_registry(loaded, second_plan)

        second_sources = {source.relpath: source.ref_id for source in second_registry.list_sources()}
        second_targets = {target.real_path.replace("\\", "/"): target.slot_id for target in second_registry.list_targets()}
        self.assertEqual(first_sources["b.txt"], second_sources["b.txt"])
        self.assertEqual(first_sources["a.txt"], second_sources["a.txt"])
        self.assertEqual(second_sources["c.txt"], "F003")
        docs_path = str((self.target_dir / "Docs").resolve()).replace("\\", "/")
        images_path = str((self.target_dir / "Images").resolve()).replace("\\", "/")
        self.assertEqual(first_targets[docs_path], second_targets[docs_path])
        self.assertEqual(second_targets[images_path], "D002")

    def test_create_session_does_not_resume_when_source_collection_differs(self):
        source_a = self.root / "SourceA"
        source_b = self.root / "SourceB"
        source_a.mkdir()
        source_b.mkdir()

        created = self.service.create_session(
            [{"source_type": "directory", "path": str(source_a), "directory_mode": "atomic"}],
            resume_if_exists=False,
            organize_method="categorize_into_new_structure",
            output_dir=str(self.target_dir),
        )

        next_result = self.service.create_session(
            [{"source_type": "directory", "path": str(source_b), "directory_mode": "atomic"}],
            resume_if_exists=True,
            organize_method="categorize_into_new_structure",
            output_dir=str(self.target_dir),
        )

        self.assertEqual(next_result.mode, "created")
        self.assertIsNotNone(next_result.session)
        self.assertNotEqual(next_result.session.session_id, created.session.session_id)
        abandoned = self.store.load(created.session.session_id)
        self.assertEqual(abandoned.stage, "abandoned")

    def test_create_session_does_not_resume_when_strategy_differs(self):
        created = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            strategy={"note": "旧要求"},
        )

        next_result = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=True,
            strategy={"note": "新要求"},
        )

        self.assertEqual(next_result.mode, "created")
        self.assertIsNotNone(next_result.session)
        self.assertNotEqual(next_result.session.session_id, created.session.session_id)
        abandoned = self.store.load(created.session.session_id)
        self.assertEqual(abandoned.stage, "abandoned")

    def test_create_session_allows_new_session_when_latest_session_completed(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "completed"
        self.store.save(session)

        follow_up = self.service.create_session(str(self.target_dir), resume_if_exists=False)

        self.assertEqual(follow_up.mode, "created")
        self.assertNotEqual(follow_up.session.session_id, session.session_id)

    def test_create_session_persists_strategy_and_exposes_snapshot_summary(self):
        created = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            strategy={
                "template_id": "project_workspace",
                "language": "en",
                "density": "normal",
                "prefix_style": "none",
                "caution_level": "balanced",
                "note": "项目文件尽量按交付物归档",
            },
        )

        session = created.session
        assert session is not None
        snapshot = self.service.get_snapshot(session.session_id)

        self.assertEqual(session.strategy_template_id, "project_workspace")
        self.assertEqual(session.language, "en")
        self.assertEqual(session.density, "normal")
        self.assertEqual(session.prefix_style, "none")
        self.assertEqual(session.caution_level, "balanced")
        self.assertEqual(session.strategy_note, "项目文件尽量按交付物归档")
        self.assertEqual(session.user_constraints, ["项目文件尽量按交付物归档"])
        self.assertEqual(snapshot["strategy"]["template_id"], "project_workspace")
        self.assertEqual(snapshot["strategy"]["template_label"], "项目资料")
        self.assertEqual(snapshot["strategy"]["task_type"], "organize_full_directory")
        self.assertEqual(snapshot["strategy"]["task_type_label"], "整理整个目录")
        self.assertEqual(snapshot["strategy"]["language_label"], "英文目录")
        self.assertEqual(snapshot["strategy"]["density_label"], "常规分类")
        self.assertEqual(snapshot["strategy"]["prefix_style_label"], "无前缀")
        self.assertEqual(snapshot["strategy"]["note"], "项目文件尽量按交付物归档")

    def test_create_session_supports_personal_archive_template(self):
        created = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            strategy={
                "template_id": "personal_archive",
                "language": "zh",
                "density": "normal",
                "prefix_style": "none",
                "caution_level": "balanced",
                "note": "证件和账单优先分开",
            },
        )

        session = created.session
        assert session is not None
        snapshot = self.service.get_snapshot(session.session_id)

        self.assertEqual(session.strategy_template_id, "personal_archive")
        self.assertEqual(snapshot["strategy"]["template_id"], "personal_archive")
        self.assertEqual(snapshot["strategy"]["template_label"], "个人资料")
        self.assertEqual(snapshot["strategy"]["note"], "证件和账单优先分开")

    def test_create_session_persists_incremental_mode_and_destination_depth(self):
        created = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            strategy={
                "template_id": "general_downloads",
                "organize_mode": "incremental",
                "destination_index_depth": 3,
                "language": "zh",
                "density": "normal",
                "prefix_style": "none",
                "caution_level": "balanced",
                "note": "",
            },
        )

        session = created.session
        assert session is not None
        snapshot = self.service.get_snapshot(session.session_id)

        self.assertEqual(session.organize_mode, "incremental")
        self.assertEqual(session.destination_index_depth, 3)
        self.assertEqual(snapshot["strategy"]["task_type"], "organize_into_existing")
        self.assertEqual(snapshot["strategy"]["task_type_label"], "归入已有目录")
        self.assertEqual(snapshot["strategy"]["organize_mode"], "incremental")
        self.assertEqual(snapshot["strategy"]["destination_index_depth"], 3)
        self.assertTrue(snapshot["incremental_selection"]["required"])

    def test_create_session_accepts_task_type_without_organize_mode(self):
        created = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            strategy={
                "template_id": "general_downloads",
                "task_type": "organize_into_existing",
                "destination_index_depth": 2,
                "language": "zh",
                "density": "normal",
                "prefix_style": "none",
                "caution_level": "balanced",
                "note": "",
            },
        )

        session = created.session
        assert session is not None
        snapshot = self.service.get_snapshot(session.session_id)

        self.assertEqual(session.organize_mode, "incremental")
        self.assertEqual(snapshot["strategy"]["task_type"], "organize_into_existing")
        self.assertEqual(snapshot["strategy"]["organize_mode"], "incremental")

    def test_create_session_rejects_conflicting_task_type_and_organize_mode(self):
        with self.assertRaisesRegex(ValueError, "TASK_TYPE_CONFLICT"):
            self.service.create_session(
                str(self.target_dir),
                resume_if_exists=False,
                strategy={
                    "template_id": "general_downloads",
                    "task_type": "organize_into_existing",
                    "organize_mode": "initial",
                    "destination_index_depth": 2,
                    "language": "zh",
                    "density": "normal",
                    "prefix_style": "none",
                    "caution_level": "balanced",
                    "note": "",
                },
            )

    def test_get_snapshot_repairs_missing_incremental_organize_method(self):
        session = OrganizerSession(
            session_id="legacy-session",
            target_dir=str(self.target_dir),
            organize_mode="incremental",
            organize_method="",
        )
        self.store.save(session)

        reloaded = self.store.load("legacy-session")
        self.assertEqual(reloaded.organize_mode, "incremental")
        self.assertEqual(reloaded.organize_method, "assign_into_existing_categories")

        snapshot = self.service.get_snapshot("legacy-session")

        self.assertEqual(snapshot["strategy"]["organize_mode"], "incremental")
        self.assertEqual(snapshot["strategy"]["organize_method"], "assign_into_existing_categories")
        self.assertEqual(snapshot["strategy"]["task_type"], "organize_into_existing")

    def test_create_session_requires_abandon_before_replacing_active_session(self):
        self.service.create_session(str(self.target_dir), resume_if_exists=False)

        with self.assertRaisesRegex(RuntimeError, "SESSION_LOCKED"):
            self.service.create_session(str(self.target_dir), resume_if_exists=False)

    def test_abandon_session_releases_lock_and_allows_new_session(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)

        self.service.abandon_session(created.session.session_id)
        replacement = self.service.create_session(str(self.target_dir), resume_if_exists=False)

        self.assertEqual(replacement.mode, "created")
        self.assertNotEqual(replacement.session.session_id, created.session.session_id)

    def test_resume_session_marks_stale_when_directory_entries_changed(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        created.session.stage = "planning"
        created.session.scan_lines = "a.txt | 文档 | A"
        self.store.save(created.session)

        (self.target_dir / "b.txt").write_text("new", encoding="utf-8")

        resumed = self.service.resume_session(created.session.session_id)

        self.assertEqual(resumed.stage, "stale")
        self.assertEqual(resumed.stale_reason, "directory_changed")

    def test_resume_session_marks_stale_when_entry_names_change_but_count_stays_same(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        created.session.stage = "planning"
        created.session.scan_lines = "a.txt | 文档 | A"
        (self.target_dir / "a.txt").write_text("old", encoding="utf-8")
        self.store.save(created.session)

        (self.target_dir / "a.txt").unlink()
        (self.target_dir / "b.txt").write_text("new", encoding="utf-8")

        resumed = self.service.resume_session(created.session.session_id)

        self.assertEqual(resumed.stage, "stale")
        self.assertEqual(resumed.stale_reason, "directory_changed")

    def test_create_session_allows_replacement_after_latest_session_becomes_stale(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "stale"
        self.store.save(session)

        replacement = self.service.create_session(str(self.target_dir), resume_if_exists=False)

        self.assertEqual(replacement.mode, "created")
        self.assertNotEqual(replacement.session.session_id, session.session_id)

    def test_create_session_still_blocks_when_latest_session_is_interrupted(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "interrupted"
        self.store.save(session)

        with self.assertRaisesRegex(RuntimeError, "SESSION_LOCKED"):
            self.service.create_session(str(self.target_dir), resume_if_exists=False)

    def test_run_precheck_sets_ready_to_execute_for_valid_pending_plan(self):
        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "a.txt", "target": "Docs/a.txt"}],
            "unresolved_items": [],
            "summary": "move to docs",
        }
        self.store.save(session)

        result = self.service.run_precheck(session.session_id)

        self.assertEqual(result.session_snapshot["stage"], "ready_to_execute")
        self.assertTrue(result.session_snapshot["precheck_summary"]["can_execute"])

    def test_return_to_planning_clears_precheck_summary_and_restores_precheck_ready_stage(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "ready_to_execute"
        session.scan_lines = "a.txt | 文档 | A"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "a.txt", "target": "Docs/a.txt"}],
            "unresolved_items": [],
            "summary": "move to docs",
        }
        session.precheck_summary = {"can_execute": True, "blocking_errors": [], "warnings": []}
        self.store.save(session)

        result = self.service.return_to_planning(session.session_id)

        self.assertEqual(result.session_snapshot["stage"], "ready_for_precheck")
        self.assertIsNone(result.session_snapshot["precheck_summary"])

    def test_execute_moves_files_and_marks_completed(self):
        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "ready_to_execute"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "a.txt", "target": "Docs/a.txt"}],
            "unresolved_items": [],
            "summary": "move to docs",
        }
        self.store.save(session)

        result = self.service.execute(session.session_id, confirm=True)

        self.assertEqual(result.session_snapshot["stage"], "completed")
        self.assertTrue((self.target_dir / "Docs" / "a.txt").exists())
        self.assertEqual(result.session_snapshot["execution_report"]["status"], "success")

    def test_rollback_after_execute_marks_stale_and_restores_file(self):
        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "ready_to_execute"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "a.txt", "target": "Docs/a.txt"}],
            "unresolved_items": [],
            "summary": "move to docs",
        }
        self.store.save(session)
        self.service.execute(session.session_id, confirm=True)

        result = self.service.rollback(session.session_id, confirm=True)

        self.assertEqual(result.session_snapshot["stage"], "stale")
        self.assertTrue((self.target_dir / "a.txt").exists())
        self.assertFalse((self.target_dir / "Docs" / "a.txt").exists())
        self.assertEqual(result.session_snapshot["rollback_report"]["status"], "success")

    def test_execute_and_rollback_write_runtime_log_summaries(self):
        log_dir = self.root / "logs" / "backend"
        setup_backend_logging(log_dir=log_dir)
        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "ready_to_execute"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "a.txt", "target": "Docs/a.txt"}],
            "unresolved_items": [],
            "summary": "move to docs",
        }
        self.store.save(session)

        self.service.execute(session.session_id, confirm=True)
        self.service.rollback(session.session_id, confirm=True)

        content = (log_dir / "runtime.log").read_text(encoding="utf-8")
        self.assertIn("execution.completed", content)
        self.assertIn("rollback.completed", content)

    def test_start_scan_moves_session_into_planning_when_runner_finishes(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None

        self.service.start_scan(session.session_id, scan_runner=lambda path: "a.txt | 文档 | A")
        scanned = self.store.load(session.session_id)

        self.assertIsNotNone(scanned)
        self.assertEqual(scanned.stage, "planning")
        self.assertEqual(scanned.scan_lines, "a.txt | 文档 | A")
        self.assertEqual(scanned.scanner_progress["status"], "completed")

    def test_initial_source_collection_scan_progress_uses_selected_source_count(self):
        extra_dir = self.target_dir / "extra"
        extra_dir.mkdir()
        for index in range(20):
            (extra_dir / f"noise-{index}.txt").write_text("noise", encoding="utf-8")

        selected_files = []
        for name in ["a.txt", "b.txt", "c.txt", "d.txt"]:
            path = self.target_dir / name
            path.write_text(name, encoding="utf-8")
            selected_files.append({"source_type": "file", "path": str(path)})

        created = self.service.create_session(
            selected_files,
            resume_if_exists=False,
            organize_method="categorize_into_new_structure",
            output_dir=str(self.target_dir),
        )
        session = created.session
        assert session is not None

        progress = self.service._initial_source_collection_scan_progress(session)

        self.assertEqual(progress["total_count"], 4)
        self.assertEqual(len(progress["recent_analysis_items"]), 4)
        self.assertEqual(progress["message"], "正在读取本次整理来源")

    def test_start_scan_in_incremental_mode_prepares_selection_without_auto_planning(self):
        created = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            organize_method="assign_into_existing_categories",
            strategy={"organize_mode": "incremental", "destination_index_depth": 2},
        )
        session = created.session
        assert session is not None
        (self.target_dir / "docs").mkdir()
        (self.target_dir / "docs" / "nested").mkdir()
        (self.target_dir / "new.txt").write_text("hello", encoding="utf-8")

        self.service.start_scan(
            session.session_id,
            scan_runner=lambda path: "docs | dir | 已整理目录 | 保留原结构\nnew.txt | file | 新增文件 | 待归档",
        )
        scanned = self.store.load(session.session_id)

        self.assertIsNotNone(scanned)
        assert scanned is not None
        self.assertEqual(scanned.stage, "planning")
        self.assertEqual(scanned.incremental_selection["status"], "ready")
        self.assertEqual(scanned.incremental_selection["target_directories"], [str(self.target_dir)])
        self.assertTrue(scanned.incremental_selection["source_scan_completed"])
        self.assertEqual([item["source_relpath"] for item in scanned.planner_items], ["docs", "new.txt"])
        self.assertEqual(scanned.pending_plan.moves, [])
        self.assertEqual(scanned.pending_plan.unresolved_items, [])

    def test_confirm_target_directories_builds_planner_items_for_unselected_roots(self):
        created = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            strategy={"organize_mode": "incremental", "destination_index_depth": 2},
        )
        session = created.session
        assert session is not None
        session.selected_target_directories = []
        session.incremental_selection = {}
        self.store.save(session)
        (self.target_dir / "Docs").mkdir()
        (self.target_dir / "Docs" / "Finance").mkdir(parents=True, exist_ok=True)
        (self.target_dir / "invoice.pdf").write_text("hello", encoding="utf-8")
        (self.target_dir / "notes.txt").write_text("note", encoding="utf-8")
        self.service.start_scan(
            session.session_id,
            scan_runner=lambda path: "Docs | dir | 已整理目录 | 保留原结构\ninvoice.pdf | file | 财务票据 | 发票\nnotes.txt | file | 学习笔记 | 笔记",
        )

        with mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
            return_value=(
                "已生成增量方案",
                {
                    "pending_plan": PendingPlan(
                        moves=[
                            PlanMove(source="invoice.pdf", target="Docs/Finance/invoice.pdf"),
                            PlanMove(source="notes.txt", target="notes.txt"),
                        ],
                        unresolved_items=[],
                        summary="已分类 2 项，调整 2 项，仍剩 0 项待定",
                    ),
                    "assistant_message": {"role": "assistant", "content": "已生成增量方案"},
                },
            ),
        ):
            result = self.service.confirm_target_directories(
                session.session_id,
                ["Docs"],
                scan_runner=lambda path: "Docs | dir | 已整理目录 | 保留原结构\ninvoice.pdf | file | 财务票据 | 发票\nnotes.txt | file | 学习笔记 | 笔记",
            )

        self.assertEqual(result.session_snapshot["stage"], "ready_for_precheck")
        self.assertEqual(result.session_snapshot["incremental_selection"]["target_directories"], ["Docs"])
        self.assertTrue(result.session_snapshot["incremental_selection"]["source_scan_completed"])
        self.assertEqual(result.session_snapshot["incremental_selection"]["pending_items_count"], 2)
        self.assertEqual(
            [item["source_relpath"] for item in self.store.load(session.session_id).planner_items],
            ["invoice.pdf", "notes.txt"],
        )

    def test_confirm_target_directories_reconciles_incremental_organize_method(self):
        created = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            strategy={"organize_mode": "incremental", "destination_index_depth": 2},
        )
        session = created.session
        assert session is not None
        session.organize_method = ""
        session.selected_target_directories = []
        session.incremental_selection = {}
        self.store.save(session)
        (self.target_dir / "Docs").mkdir()
        (self.target_dir / "invoice.pdf").write_text("hello", encoding="utf-8")

        self.service.start_scan(
            session.session_id,
            scan_runner=lambda path: "Docs | dir | 已整理目录 | 保留原结构\ninvoice.pdf | file | 财务票据 | 发票",
        )

        with mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
            return_value=(
                "已生成增量方案",
                {
                    "pending_plan": PendingPlan(
                        moves=[PlanMove(source="invoice.pdf", target="Docs/invoice.pdf")],
                        unresolved_items=[],
                        summary="已分类 1 项，调整 1 项，仍剩 0 项待定",
                    ),
                    "assistant_message": {"role": "assistant", "content": "已生成增量方案"},
                },
            ),
        ):
            result = self.service.confirm_target_directories(
                session.session_id,
                ["Docs"],
                scan_runner=lambda path: "Docs | dir | 已整理目录 | 保留原结构\ninvoice.pdf | file | 财务票据 | 发票",
            )

        reloaded = self.store.load(session.session_id)
        self.assertEqual(reloaded.organize_mode, "incremental")
        self.assertEqual(reloaded.organize_method, "assign_into_existing_categories")
        self.assertEqual(result.session_snapshot["strategy"]["task_type"], "organize_into_existing")
        self.assertEqual(result.session_snapshot["strategy"]["organize_method"], "assign_into_existing_categories")

    def test_run_precheck_blocks_incremental_target_outside_allowed_roots(self):
        created = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            strategy={"organize_mode": "incremental", "destination_index_depth": 2},
        )
        session = created.session
        assert session is not None
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
        session.pending_plan = self.service._pending_plan_to_dict(
            PendingPlan(
                moves=[PlanMove(source="invoice.pdf", target="Archive/invoice.pdf")],
                unresolved_items=[],
                summary="已分类 1 项，调整 1 项，仍剩 0 项待定",
            )
        )
        session.incremental_selection = {
            "required": True,
            "status": "ready",
            "root_directory_options": ["Archive", "Docs"],
            "target_directories": ["Docs"],
            "target_directory_tree": [{"relpath": "Docs", "name": "Docs", "children": []}],
            "pending_items_count": 1,
            "source_scan_completed": True,
        }
        self.store.save(session)

        result = self.service.run_precheck(session.session_id)

        self.assertFalse(result.session_snapshot["precheck_summary"]["can_execute"])
        self.assertTrue(
            any("“归入已有目录”任务的目标超出允许范围" in item for item in result.session_snapshot["precheck_summary"]["blocking_errors"])
        )

    def test_run_precheck_allows_incremental_target_selected_as_absolute_path(self):
        docs_dir = (self.target_dir / "Docs").resolve()
        docs_dir.mkdir(parents=True, exist_ok=True)
        (self.target_dir / "invoice.pdf").write_text("hello", encoding="utf-8")
        created = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            strategy={"organize_mode": "incremental", "destination_index_depth": 2},
        )
        session = created.session
        assert session is not None
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
        session.pending_plan = self.service._pending_plan_to_dict(
            PendingPlan(
                moves=[PlanMove(source="invoice.pdf", target="Docs/invoice.pdf")],
                unresolved_items=[],
                summary="已分类 1 项，调整 1 项，仍剩 0 项待定",
            )
        )
        session.incremental_selection = {
            "required": True,
            "status": "ready",
            "destination_index_depth": 2,
            "root_directory_options": [str(docs_dir)],
            "target_directories": [str(docs_dir)],
            "target_directory_tree": [{"relpath": str(docs_dir), "name": "Docs", "children": []}],
            "pending_items_count": 1,
            "source_scan_completed": True,
        }
        self.store.save(session)

        result = self.service.run_precheck(session.session_id)

        self.assertTrue(result.session_snapshot["precheck_summary"]["can_execute"])
        self.assertEqual(result.session_snapshot["stage"], "ready_to_execute")

    def test_run_precheck_uses_mapping_item_ids_for_move_preview(self):
        (self.target_dir / "invoice.pdf").write_text("hello", encoding="utf-8")
        created = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            strategy={"organize_mode": "incremental", "destination_index_depth": 2},
        )
        session = created.session
        assert session is not None
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
            "destination_index_depth": 2,
            "root_directory_options": ["Docs"],
            "target_directories": ["Docs"],
            "target_directory_tree": [{"relpath": "Docs", "name": "Docs", "children": []}],
            "pending_items_count": 1,
            "source_scan_completed": True,
        }
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "invoice.pdf", "target": "Docs/invoice.pdf"}],
            "unresolved_items": [],
            "summary": "move to docs",
        }
        self.store.save(session)

        result = self.service.run_precheck(session.session_id)

        preview = result.session_snapshot["precheck_summary"]["move_preview"]
        self.assertEqual(preview[0]["item_id"], "F001")
        self.assertEqual(preview[0]["source"], "invoice.pdf")
        self.assertEqual(preview[0]["target"], "Docs/invoice.pdf")

    def test_plan_snapshot_groups_follow_mapping_target_slot(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.scan_lines = "a.txt | file | 学习资料 | A"
        session.planner_items = [
            {
                "planner_id": "F001",
                "source_relpath": "a.txt",
                "display_name": "a.txt",
                "suggested_purpose": "学习资料",
                "summary": "A",
                "entry_type": "file",
                "ext": "txt",
                "parent_hint": "",
            }
        ]
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "a.txt", "target": "Docs/a.txt"}],
            "unresolved_items": [],
            "summary": "move to docs",
        }
        self.store.save(session)

        snapshot = self.service.get_snapshot(session.session_id)

        self.assertEqual(snapshot["plan_snapshot"]["items"][0]["item_id"], "F001")
        self.assertEqual(snapshot["plan_snapshot"]["items"][0]["target_slot_id"], "D001")
        self.assertEqual(snapshot["plan_snapshot"]["groups"][0]["directory"], "Docs")
        self.assertEqual(snapshot["plan_snapshot"]["groups"][0]["items"][0]["item_id"], "F001")

    def test_build_manual_sync_diff_lines_uses_item_id_as_primary_key(self):
        previous_snapshot = {
            "items": [
                {
                    "item_id": "F001",
                    "display_name": "report.pdf",
                    "source_relpath": "old/report.pdf",
                    "target_slot_id": "D001",
                }
            ],
            "target_slots": [
                {"slot_id": "D001", "display_name": "Docs", "relpath": "Docs", "depth": 0, "is_new": False},
                {"slot_id": "D002", "display_name": "Archive", "relpath": "Archive", "depth": 0, "is_new": False},
            ],
            "unresolved_items": [],
        }
        updated_snapshot = {
            "items": [
                {
                    "item_id": "F001",
                    "display_name": "report.pdf",
                    "source_relpath": "new/report.pdf",
                    "target_slot_id": "D002",
                }
            ],
            "target_slots": [
                {"slot_id": "D001", "display_name": "Docs", "relpath": "Docs", "depth": 0, "is_new": False},
                {"slot_id": "D002", "display_name": "Archive", "relpath": "Archive", "depth": 0, "is_new": False},
            ],
            "unresolved_items": [],
        }

        diff_lines = self.service.snapshot_builder.build_manual_sync_diff_lines(previous_snapshot, updated_snapshot)

        self.assertIn("调整移动：report.pdf -> Archive/report.pdf", diff_lines)

    def test_start_scan_snapshot_includes_complete_source_tree_entries(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        (self.target_dir / "docs").mkdir()
        (self.target_dir / "docs" / "a.txt").write_text("hello", encoding="utf-8")
        (self.target_dir / "notes.txt").write_text("note", encoding="utf-8")

        self.service.start_scan(
            session.session_id,
            scan_runner=lambda path: "docs | dir | 项目目录 | 原始目录\ndocs/a.txt | file | 文档 | A\nnotes.txt | file | 记录 | B",
        )

        snapshot = self.service.get_snapshot(session.session_id)

        self.assertEqual(
            snapshot["source_tree_entries"],
            [
                {"source_relpath": "docs", "display_name": "docs", "entry_type": "directory"},
                {"source_relpath": "notes.txt", "display_name": "notes.txt", "entry_type": "file"},
                {"source_relpath": "docs/a.txt", "display_name": "a.txt", "entry_type": "file"},
            ],
        )

    def test_start_scan_marks_session_interrupted_when_async_scan_returns_empty_for_nonempty_directory(self):
        service = OrganizerSessionService(self.store, scanner=ImmediateScanner())
        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        created = service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None

        with mock.patch(
            "file_pilot.app.session_service.analysis_service.run_analysis_cycle",
            return_value=None,
        ), mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
        ) as organizer_cycle_mock:
            service.start_scan(session.session_id)

        scanned = self.store.load(session.session_id)
        self.assertIsNotNone(scanned)
        assert scanned is not None
        self.assertEqual(scanned.stage, "interrupted")
        self.assertEqual(scanned.last_error, "scan_empty_result")
        self.assertEqual(scanned.scanner_progress["status"], "failed")
        self.assertEqual(scanned.scanner_progress["message"], "扫描未返回任何条目，请检查模型输出或调试日志")
        organizer_cycle_mock.assert_not_called()
        error_events = [event for event in service.read_events(session.session_id) if event["event_type"] == "session.error"]
        self.assertTrue(error_events)

    def test_start_scan_sync_runner_raises_when_scan_returns_empty_for_nonempty_directory(self):
        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None

        with self.assertRaisesRegex(RuntimeError, "scan_empty_result"):
            self.service.start_scan(session.session_id, scan_runner=lambda path, session_id=None: "")

        scanned = self.store.load(session.session_id)
        self.assertIsNotNone(scanned)
        assert scanned is not None
        self.assertEqual(scanned.stage, "interrupted")
        self.assertEqual(scanned.last_error, "scan_empty_result")
        self.assertEqual(scanned.scanner_progress["status"], "failed")

    def test_start_scan_handles_empty_directory_without_marking_failure(self):
        service = OrganizerSessionService(self.store, scanner=ImmediateScanner())
        created = service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None

        with mock.patch(
            "file_pilot.app.session_service.analysis_service.run_analysis_cycle",
            return_value=None,
        ), mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
        ) as organizer_cycle_mock:
            service.start_scan(session.session_id)

        scanned = self.store.load(session.session_id)
        self.assertIsNotNone(scanned)
        assert scanned is not None
        self.assertEqual(scanned.stage, "completed")
        self.assertEqual(scanned.summary, "当前目录为空，无需整理")
        self.assertEqual(scanned.scanner_progress["status"], "completed")
        self.assertEqual(scanned.scanner_progress["message"], "目录为空，无需整理")
        self.assertIsNone(scanned.last_error)
        self.assertEqual(scanned.assistant_message["content"], "当前目录为空，没有可整理的文件。")
        self.assertTrue(scanned.integrity_flags["empty_scan_result"])
        self.assertIsNone(scanned.precheck_summary)
        organizer_cycle_mock.assert_not_called()

    def test_start_scan_tracks_parallel_batch_progress_in_snapshot(self):
        service = OrganizerSessionService(self.store, scanner=ImmediateScanner())
        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        created = service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None

        def fake_run_analysis_cycle(_target_dir, event_handler=None):
            if event_handler is not None:
                event_handler("batch_split", {"total_entries": 60, "batch_count": 4, "worker_count": 4})
                event_handler("batch_progress", {"batch_index": 0, "total_batches": 4, "status": "completed", "completed_batches": 1})
                event_handler("batch_progress", {"batch_index": 1, "total_batches": 4, "status": "completed", "completed_batches": 2})
                event_handler("batch_progress", {"batch_index": 2, "total_batches": 4, "status": "completed", "completed_batches": 3})
                event_handler("batch_progress", {"batch_index": 3, "total_batches": 4, "status": "completed", "completed_batches": 4})
            return "a.txt | 文档 | A"

        with mock.patch(
            "file_pilot.app.session_service.analysis_service.run_analysis_cycle",
            side_effect=fake_run_analysis_cycle,
        ), mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
            return_value=("", None),
        ):
            service.start_scan(session.session_id)

        scanned = self.store.load(session.session_id)
        assert scanned is not None
        self.assertEqual(scanned.scanner_progress["batch_count"], 4)
        self.assertEqual(scanned.scanner_progress["completed_batches"], 4)
        self.assertEqual(scanned.scanner_progress["message"], "已完成 4/4 批并行分析")
        self.assertEqual(scanned.stage, "planning")
        self.assertTrue(any(event["event_type"] == "scan.progress" for event in service.read_events(session.session_id)))

    def test_start_scan_tracks_file_level_progress_during_parallel_scan(self):
        service = OrganizerSessionService(self.store, scanner=ImmediateScanner())
        (self.target_dir / "report.pdf").write_text("hello", encoding="utf-8")
        created = service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None

        def fake_run_analysis_cycle(_target_dir, event_handler=None):
            if event_handler is not None:
                event_handler("batch_split", {"total_entries": 31, "batch_count": 3, "worker_count": 3})
                event_handler("tool_start", {"name": "read_local_file", "args": {"filename": "report.pdf"}})
                event_handler("batch_progress", {"batch_index": 0, "total_batches": 3, "status": "completed", "completed_batches": 1})
            return "report.pdf | 文档 | A"

        with mock.patch(
            "file_pilot.app.session_service.analysis_service.run_analysis_cycle",
            side_effect=fake_run_analysis_cycle,
        ), mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
            return_value=("", None),
        ):
            service.start_scan(session.session_id)

        progress_events = [
            event for event in service.read_events(session.session_id) if event["event_type"] == "scan.progress"
        ]
        self.assertTrue(progress_events)
        progress_snapshots = [event["session_snapshot"]["scanner_progress"] for event in progress_events]
        self.assertTrue(
            any(
                progress["current_item"] == "report.pdf"
                and progress["message"] == "正在读取 report.pdf"
                and any(item["display_name"] == "report.pdf" for item in progress.get("recent_analysis_items", []))
                for progress in progress_snapshots
            )
        )

    def test_start_scan_keeps_failed_batch_out_of_completed_progress_and_marks_retrying(self):
        service = OrganizerSessionService(self.store, scanner=ImmediateScanner())
        (self.target_dir / "report.pdf").write_text("hello", encoding="utf-8")
        created = service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None

        def fake_run_analysis_cycle(_target_dir, event_handler=None):
            if event_handler is not None:
                event_handler("batch_split", {"total_entries": 60, "batch_count": 4, "worker_count": 4})
                event_handler("batch_progress", {"batch_index": 0, "total_batches": 4, "status": "completed", "completed_batches": 1, "batch_size": 15})
                event_handler("batch_progress", {"batch_index": 1, "total_batches": 4, "status": "failed", "completed_batches": 1, "batch_size": 15})
                event_handler("batch_progress", {"total_batches": 4, "status": "retrying", "completed_batches": 1, "batch_size": 15})
            return "report.pdf | 文档 | A"

        with mock.patch(
            "file_pilot.app.session_service.analysis_service.run_analysis_cycle",
            side_effect=fake_run_analysis_cycle,
        ), mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
            return_value=("", None),
        ):
            service.start_scan(session.session_id)

        progress_events = [
            event for event in service.read_events(session.session_id) if event["event_type"] == "scan.progress"
        ]
        self.assertTrue(progress_events)
        progress_snapshots = [event["session_snapshot"]["scanner_progress"] for event in progress_events]
        self.assertTrue(
            any(
                progress["completed_batches"] == 1
                and progress["message"] == "正在重试失败批次"
                for progress in progress_snapshots
            )
        )

    def test_start_scan_marks_placeholder_results_as_incomplete_and_skips_auto_plan(self):
        service = OrganizerSessionService(self.store, scanner=ImmediateScanner())
        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        created = service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None

        with mock.patch(
            "file_pilot.app.session_service.analysis_service.run_analysis_cycle",
            return_value="a.txt | 待判断 | 分析未覆盖，需手动确认",
        ), mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
        ) as organizer_cycle_mock:
            service.start_scan(session.session_id)

        scanned = self.store.load(session.session_id)
        assert scanned is not None
        self.assertEqual(scanned.stage, "interrupted")
        self.assertEqual(scanned.scanner_progress["status"], "failed")
        self.assertEqual(scanned.scanner_progress["placeholder_count"], 1)
        self.assertTrue(scanned.integrity_flags["scan_incomplete"])
        self.assertEqual(scanned.integrity_flags["scan_placeholder_count"], 1)
        self.assertIn("1 项未成功分析", scanned.last_error)
        organizer_cycle_mock.assert_not_called()

    def test_start_scan_continues_when_failed_batch_is_recovered_by_retry(self):
        service = OrganizerSessionService(self.store, scanner=ImmediateScanner())
        (self.target_dir / "report.pdf").write_text("hello", encoding="utf-8")
        created = service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None

        def fake_run_analysis_cycle(_target_dir, event_handler=None):
            if event_handler is not None:
                event_handler("batch_split", {"total_entries": 31, "batch_count": 2, "worker_count": 2})
                event_handler("batch_progress", {"batch_index": 0, "total_batches": 2, "status": "failed", "completed_batches": 0, "batch_size": 16})
                event_handler("batch_progress", {"total_batches": 2, "status": "retrying", "completed_batches": 0, "batch_size": 16})
                event_handler("batch_progress", {"batch_index": 1, "total_batches": 2, "status": "completed", "completed_batches": 1, "batch_size": 15})
                event_handler("batch_progress", {"batch_index": 2, "total_batches": 2, "status": "completed", "completed_batches": 2, "batch_size": 16})
            return "report.pdf | 文档 | A"

        with mock.patch(
            "file_pilot.app.session_service.analysis_service.run_analysis_cycle",
            side_effect=fake_run_analysis_cycle,
        ), mock.patch.object(
            service.orchestrator,
            "maybe_run_auto_plan_after_scan",
            return_value=None,
        ) as auto_plan_mock:
            service.start_scan(session.session_id)

        scanned = self.store.load(session.session_id)
        assert scanned is not None
        self.assertEqual(scanned.stage, "planning")
        self.assertEqual(scanned.scanner_progress["status"], "completed")
        self.assertTrue(scanned.scanner_progress["had_failed_batches"])
        self.assertFalse(scanned.scanner_progress["unrecovered_failed_batches"])
        self.assertEqual(scanned.scanner_progress["message"], "已完成 2/2 批并行分析，失败批次已自动补齐")
        self.assertNotIn("scan_incomplete", scanned.integrity_flags)
        self.assertIsNone(scanned.last_error)
        auto_plan_mock.assert_called_once()

    def test_start_scan_marks_failed_batch_scan_as_incomplete_when_retry_does_not_recover(self):
        service = OrganizerSessionService(self.store, scanner=ImmediateScanner())
        (self.target_dir / "report.pdf").write_text("hello", encoding="utf-8")
        created = service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None

        def fake_run_analysis_cycle(_target_dir, event_handler=None):
            if event_handler is not None:
                event_handler("batch_split", {"total_entries": 31, "batch_count": 2, "worker_count": 2})
                event_handler("batch_progress", {"batch_index": 0, "total_batches": 2, "status": "failed", "completed_batches": 0, "batch_size": 16})
                event_handler("batch_progress", {"total_batches": 2, "status": "retrying", "completed_batches": 0, "batch_size": 16})
                event_handler("batch_progress", {"batch_index": 1, "total_batches": 2, "status": "completed", "completed_batches": 1, "batch_size": 15})
            return "report.pdf | 文档 | A"

        with mock.patch(
            "file_pilot.app.session_service.analysis_service.run_analysis_cycle",
            side_effect=fake_run_analysis_cycle,
        ), mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
        ) as organizer_cycle_mock:
            service.start_scan(session.session_id)

        scanned = self.store.load(session.session_id)
        assert scanned is not None
        self.assertEqual(scanned.stage, "interrupted")
        self.assertEqual(scanned.scanner_progress["status"], "failed")
        self.assertTrue(scanned.integrity_flags["scan_had_failed_batches"])
        self.assertTrue(scanned.integrity_flags["scan_unrecovered_failed_batches"])
        self.assertIn("重试后仍有失败批次", scanned.last_error)
        organizer_cycle_mock.assert_not_called()

    def test_start_scan_writes_runtime_log_for_create_scan_and_auto_plan(self):
        log_dir = self.root / "logs" / "backend"
        setup_backend_logging(log_dir=log_dir)
        service = OrganizerSessionService(self.store, scanner=ImmediateScanner())
        created = service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        pending = PendingPlan(
            directories=["Docs"],
            moves=[PlanMove(source="a.txt", target="Docs/a.txt")],
            unresolved_items=[],
            summary="planned",
        )

        with mock.patch(
            "file_pilot.app.session_service.analysis_service.run_analysis_cycle",
            return_value="a.txt | file | 文档 | A",
        ), mock.patch(
            "file_pilot.app.session_service.organize_service.build_initial_messages",
            return_value=[{"role": "system", "content": "scan"}],
        ), mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
            return_value=("已规划", {"pending_plan": pending, "is_valid": False, "diff_summary": ["planned"]}),
        ):
            service.start_scan(session.session_id)

        content = (log_dir / "runtime.log").read_text(encoding="utf-8")
        self.assertIn("session.created", content)
        self.assertIn("scan.completed", content)
        self.assertIn("plan.auto_completed", content)

    def test_start_scan_tracks_single_thread_runtime_progress_in_events(self):
        service = OrganizerSessionService(self.store, scanner=ImmediateScanner())
        (self.target_dir / "report.pdf").write_text("hello", encoding="utf-8")
        created = service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None

        def fake_run_analysis_cycle(_target_dir, event_handler=None):
            if event_handler is not None:
                event_handler("model_wait_start", {"message": "正在分析目录内容"})
                event_handler("tool_start", {"name": "read_local_file", "args": {"filename": "report.pdf"}})
                event_handler("ai_streaming_start", {})
                event_handler("validation_pass", {"attempt": 1})
            return "report.pdf | 文档 | A"

        with mock.patch(
            "file_pilot.app.session_service.analysis_service.run_analysis_cycle",
            side_effect=fake_run_analysis_cycle,
        ), mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
            return_value=("", None),
        ):
            service.start_scan(session.session_id)

        progress_events = [
            event for event in service.read_events(session.session_id) if event["event_type"] == "scan.progress"
        ]
        self.assertTrue(progress_events)
        progress_snapshots = [event["session_snapshot"]["scanner_progress"] for event in progress_events]
        self.assertTrue(
            any(
                progress["current_item"] == "report.pdf"
                and progress["message"] == "正在读取 report.pdf"
                and progress["processed_count"] == 1
                for progress in progress_snapshots
            )
        )

    def test_start_scan_surfaces_model_api_retry_in_scanner_progress(self):
        service = OrganizerSessionService(self.store, scanner=ImmediateScanner())
        (self.target_dir / "report.pdf").write_text("hello", encoding="utf-8")
        created = service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None

        def fake_run_analysis_cycle(_target_dir, event_handler=None):
            if event_handler is not None:
                event_handler("model_wait_start", {"message": "正在分析目录内容"})
                event_handler("api_retry", {
                    "attempt": 1,
                    "max_attempts": 2,
                    "retry_delay_seconds": 2,
                    "retry_after_seconds": 120,
                    "summary": "模型服务网关超时",
                })
            return "report.pdf | 文档 | A"

        with mock.patch(
            "file_pilot.app.session_service.analysis_service.run_analysis_cycle",
            side_effect=fake_run_analysis_cycle,
        ), mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
            return_value=("", None),
        ):
            service.start_scan(session.session_id)

        progress_events = [
            event for event in service.read_events(session.session_id) if event["event_type"] == "scan.progress"
        ]
        progress_snapshots = [event["session_snapshot"]["scanner_progress"] for event in progress_events]
        self.assertTrue(
            any(
                progress.get("is_retrying") is True
                and progress.get("retry_kind") == "api"
                and progress.get("current_item") == "正在等待模型服务恢复"
                and "模型服务网关超时" in str(progress.get("message") or "")
                for progress in progress_snapshots
            )
        )

    def test_submit_user_intent_updates_pending_plan_and_assistant_message(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.scan_lines = "a.txt | 文档 | A"
        self.store.save(session)

        pending = PendingPlan(
            directories=["Docs"],
            moves=[PlanMove(source="a.txt", target="Docs/a.txt")],
            unresolved_items=[],
            summary="moved",
        )

        with mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
            return_value=(
                "已更新计划",
                {
                    "pending_plan": pending,
                    "is_valid": False,
                    "diff_summary": ["moved"],
                    "display_plan": {"focus": "summary", "summary": "moved"},
                },
            ),
        ):
            result = self.service.submit_user_intent(session.session_id, "放到文档")

        self.assertEqual(result.assistant_message["content"], "已更新计划")
        self.assertEqual(result.session_snapshot["plan_snapshot"]["summary"], "已分类 1 项，调整 1 项，仍剩 0 项待定")
        self.assertEqual(result.session_snapshot["messages"][-1]["content"], "已更新计划")
        self.assertEqual(result.session_snapshot["messages"][-1]["id"], result.assistant_message["id"])
        self.assertTrue(all(message["role"] != "tool" for message in result.session_snapshot["messages"]))

    def test_submit_user_intent_emits_planner_progress_snapshots(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.scan_lines = "a.txt | 文档 | A"
        session.plan_snapshot = {
            "summary": "旧方案",
            "items": [{"item_id": "a.txt", "source_relpath": "a.txt", "target_relpath": "Review/a.txt", "status": "review"}],
            "groups": [],
            "review_items": [],
            "invalidated_items": [],
        }
        self.store.save(session)

        pending = PendingPlan(
            directories=["Docs"],
            moves=[PlanMove(source="a.txt", target="Docs/a.txt")],
            unresolved_items=[],
            summary="moved",
        )

        def fake_cycle(**kwargs):
            event_handler = kwargs.get("event_handler")
            if event_handler is not None:
                event_handler("model_wait_start", {"message": "正在等待模型回复..."})
                event_handler("ai_chunk", {"content": "先把文件归到文档目录。"})
                event_handler("ai_streaming_end", {"full_content": "先把文件归到文档目录。"})
                event_handler("command_validation_pass", {"attempt": 1, "details": {"is_valid": True}})
            return (
                "已更新计划",
                {
                    "pending_plan": pending,
                    "is_valid": True,
                    "diff_summary": ["moved"],
                    "display_plan": {"focus": "summary", "summary": "moved"},
                },
            )

        with mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
            side_effect=fake_cycle,
        ):
            result = self.service.submit_user_intent(session.session_id, "放到文档")

        self.assertEqual(result.session_snapshot["planner_progress"]["status"], "completed")
        self.assertIsNotNone(result.session_snapshot["planner_progress"]["last_completed_at"])
        self.assertFalse(result.session_snapshot["planner_progress"]["preserving_previous_plan"])

        progress_events = [
            event for event in self.service.read_events(session.session_id) if event["event_type"] in {"plan.progress", "plan.ai_typing"}
        ]
        phases = [event["session_snapshot"]["planner_progress"]["phase"] for event in progress_events]
        self.assertIn("waiting_model", phases)
        self.assertIn("streaming_reply", phases)
        self.assertIn("validating", phases)
        self.assertIn("applying", phases)

    def test_submit_user_intent_marks_retrying_and_repairing_planner_progress(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.scan_lines = "a.txt | 文档 | A"
        session.plan_snapshot = {
            "summary": "旧方案",
            "items": [{"item_id": "a.txt", "source_relpath": "a.txt", "target_relpath": "Review/a.txt", "status": "review"}],
            "groups": [],
            "review_items": [],
            "invalidated_items": [],
        }
        self.store.save(session)

        pending = PendingPlan(
            directories=["Docs"],
            moves=[PlanMove(source="a.txt", target="Docs/a.txt")],
            unresolved_items=[],
            summary="moved",
        )

        def fake_cycle(**kwargs):
            event_handler = kwargs.get("event_handler")
            if event_handler is not None:
                event_handler("model_wait_start", {"message": "正在等待模型回复..."})
                event_handler("ai_streaming_end", {"full_content": ""})
                event_handler("command_validation_fail", {"attempt": 1, "details": {"is_valid": False}})
                event_handler("repair_mode_start", {"attempt": 2, "details": {"is_valid": False}})
                event_handler("command_validation_pass", {"attempt": 2, "details": {"is_valid": True}})
            return (
                "已更新计划",
                {
                    "pending_plan": pending,
                    "is_valid": True,
                    "diff_summary": ["moved"],
                    "display_plan": {"focus": "summary", "summary": "moved"},
                },
            )

        with mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
            side_effect=fake_cycle,
        ):
            self.service.submit_user_intent(session.session_id, "放到文档")

        progress_events = [event for event in self.service.read_events(session.session_id) if event["event_type"] == "plan.progress"]
        retry_event = next(
            event for event in progress_events if event["session_snapshot"]["planner_progress"]["phase"] == "retrying"
        )
        repairing_event = next(
            event for event in progress_events if event["session_snapshot"]["planner_progress"]["phase"] == "repairing"
        )
        self.assertEqual(retry_event["session_snapshot"]["planner_progress"]["attempt"], 2)
        self.assertEqual(repairing_event["session_snapshot"]["planner_progress"]["attempt"], 2)

    def test_submit_user_intent_preserves_assistant_tool_calls_in_session_messages(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.scan_lines = "a.txt | 文档 | A"
        self.store.save(session)

        pending = PendingPlan(
            directories=["Docs"],
            moves=[PlanMove(source="a.txt", target="Docs/a.txt")],
            unresolved_items=[],
            summary="moved",
        )
        assistant_message = {
            "role": "assistant",
            "content": "已更新计划",
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "submit_plan_diff",
                        "arguments": '{"summary":"moved"}',
                    },
                }
            ],
        }
        assistant_context_messages = [
            assistant_message,
            {
                "role": "tool",
                "tool_call_id": "call_1",
                "name": "submit_plan_diff",
                "content": '{"ok": true}',
            },
        ]

        with mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
            return_value=(
                "已更新计划",
                {
                    "pending_plan": pending,
                    "is_valid": False,
                    "diff_summary": ["moved"],
                    "display_plan": {"focus": "summary", "summary": "moved"},
                    "assistant_message": assistant_message,
                    "assistant_context_messages": assistant_context_messages,
                },
            ),
        ):
            result = self.service.submit_user_intent(session.session_id, "放到文档")

        stored = self.store.load(session.session_id)
        self.assertIsNotNone(stored)
        assert stored is not None
        self.assertEqual(result.assistant_message["content"], "已更新计划")
        self.assertEqual(result.assistant_message["tool_calls"][0]["function"]["name"], "submit_plan_diff")
        self.assertEqual(stored.messages[-2]["id"], result.assistant_message["id"])
        self.assertEqual(stored.messages[-2]["tool_calls"][0]["id"], "call_1")
        self.assertEqual(stored.messages[-1]["role"], "tool")
        self.assertEqual(stored.messages[-1]["tool_call_id"], "call_1")

    def test_get_snapshot_backfills_missing_inspection_context_for_legacy_session(self):
        (self.target_dir / "contract.pdf").write_text("hello", encoding="utf-8")
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.scan_lines = "contract.pdf | file | 财务合同 | 付款协议"
        self.service._ensure_planner_items(session, session.scan_lines)
        session.inspection_context = {}
        self.store.save(session)

        snapshot = self.service.get_snapshot(session.session_id)
        stored = self.store.load(session.session_id)

        self.assertEqual(snapshot["stage"], "planning")
        self.assertIsNotNone(stored)
        assert stored is not None
        self.assertIn("F001", stored.inspection_context)
        self.assertEqual(stored.inspection_context["F001"]["source_relpath"], "contract.pdf")
        self.assertTrue(stored.inspection_context["F001"]["absolute_path"].endswith("contract.pdf"))

    def test_get_snapshot_tolerates_legacy_unresolved_choice_blocks(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.scan_lines = "md | 学习资料 | 笔记"
        session.pending_plan = {
            "directories": ["Review"],
            "moves": [{"source": "md", "target": "Review/md"}],
            "unresolved_items": ["md"],
            "summary": "needs review",
        }
        session.messages = [
            {
                "role": "assistant",
                "content": "",
                "blocks": [
                    {
                        "type": "unresolved_choices",
                        "request_id": "legacy_1",
                        "status": "pending",
                        "items": [{"item_id": "F001", "display_name": "md"}],
                    }
                ],
            }
        ]
        session.assistant_message = dict(session.messages[0])
        self.store.save(session)

        snapshot = self.service.get_snapshot(session.session_id)

        self.assertEqual(self._plan_item_target_path(snapshot, "md"), "Review/md")
        self.assertIn(snapshot["plan_snapshot"]["stats"]["unresolved_count"], [0, 1])
        self.assertEqual(snapshot["messages"][0]["blocks"][0]["type"], "unresolved_choices")

    def test_get_snapshot_assigns_stable_message_ids(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.messages = [{"role": "assistant", "content": "hello"}]
        self.store.save(session)

        first_snapshot = self.service.get_snapshot(session.session_id)
        second_snapshot = self.service.get_snapshot(session.session_id)

        self.assertIn("id", first_snapshot["messages"][0])
        self.assertEqual(first_snapshot["messages"][0]["id"], second_snapshot["messages"][0]["id"])

    def test_start_scan_emits_scan_ai_typing_events_without_polluting_plan_stream(self):
        service = OrganizerSessionService(self.store, scanner=ImmediateScanner())
        created = service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None

        pending = PendingPlan(
            directories=["Docs"],
            moves=[PlanMove(source="a.txt", target="Docs/a.txt")],
            unresolved_items=[],
            summary="planned",
        )

        def fake_scan_runner(_target_dir, event_handler=None):
            if event_handler is not None:
                event_handler("ai_chunk", {"content": "扫描阶段摘要"})
            return "a.txt | 文档 | A"

        with mock.patch(
            "file_pilot.app.session_service.analysis_service.run_analysis_cycle",
            side_effect=fake_scan_runner,
        ), mock.patch(
            "file_pilot.app.session_service.organize_service.build_initial_messages",
            return_value=[{"role": "system", "content": "scan"}],
        ), mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
            return_value=("已规划", {"pending_plan": pending, "is_valid": False, "diff_summary": ["planned"]}),
        ):
            service.start_scan(session.session_id)

        event_types = [event["event_type"] for event in service.read_events(session.session_id)]
        self.assertIn("scan.ai_typing", event_types)
        self.assertNotIn("plan.ai_typing", [event["event_type"] for event in service.read_events(session.session_id) if event.get("content") == "扫描阶段摘要"])

    def test_start_scan_auto_plan_tracks_planner_progress(self):
        service = OrganizerSessionService(self.store, scanner=ImmediateScanner())
        created = service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None

        pending = PendingPlan(
            directories=["Docs"],
            moves=[PlanMove(source="a.txt", target="Docs/a.txt")],
            unresolved_items=[],
            summary="planned",
        )

        def fake_plan_cycle(**kwargs):
            event_handler = kwargs.get("event_handler")
            if event_handler is not None:
                event_handler("model_wait_start", {"message": "正在等待模型回复..."})
                event_handler("ai_chunk", {"content": "建议整理到 Docs。"})
                event_handler("ai_streaming_end", {"full_content": "建议整理到 Docs。"})
                event_handler("command_validation_pass", {"attempt": 1, "details": {"is_valid": True}})
            return ("已规划", {"pending_plan": pending, "is_valid": True, "diff_summary": ["planned"]})

        with mock.patch(
            "file_pilot.app.session_service.analysis_service.run_analysis_cycle",
            return_value="a.txt | file | 文档 | A",
        ), mock.patch(
            "file_pilot.app.session_service.analysis_service.run_analysis_cycle_for_entries",
            return_value="loose.txt | 文档 | 单文件说明",
        ), mock.patch(
            "file_pilot.app.session_service.organize_service.build_initial_messages",
            return_value=[{"role": "system", "content": "scan"}],
        ), mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
            side_effect=fake_plan_cycle,
        ):
            service.start_scan(session.session_id)

        snapshot = service.get_snapshot(session.session_id)
        self.assertEqual(snapshot["planner_progress"]["status"], "completed")
        self.assertFalse(snapshot["planner_progress"]["preserving_previous_plan"])
        phases = [
            event["session_snapshot"]["planner_progress"]["phase"]
            for event in service.read_events(session.session_id)
            if event["event_type"] in {"plan.progress", "plan.ai_typing"}
        ]
        self.assertIn("waiting_model", phases)
        self.assertIn("streaming_reply", phases)
        self.assertIn("validating", phases)
        self.assertIn("applying", phases)

    def test_start_scan_builds_initial_messages_with_strategy_selection_dict(self):
        service = OrganizerSessionService(self.store, scanner=ImmediateScanner())
        created = service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            strategy={
                "template_id": "project_workspace",
                "language": "en",
                "density": "normal",
                "prefix_style": "none",
                "caution_level": "balanced",
                "note": "按项目语义整理",
            },
        )
        session = created.session
        assert session is not None
        real_build_initial_messages = __import__(
            "file_pilot.organize.service", fromlist=["build_initial_messages"]
        ).build_initial_messages

        with mock.patch(
            "file_pilot.app.session_service.analysis_service.run_analysis_cycle",
            return_value="a.txt | file | 文档 | A",
        ), mock.patch(
            "file_pilot.app.session_service.organize_service.build_initial_messages",
            side_effect=real_build_initial_messages,
        ) as build_messages_mock, mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
            return_value=("已规划", {"pending_plan": PendingPlan(summary="planned"), "is_valid": False, "diff_summary": ["planned"]}),
        ):
            service.start_scan(session.session_id)

        _, kwargs = build_messages_mock.call_args
        self.assertIsInstance(kwargs["strategy"], dict)
        self.assertEqual(kwargs["strategy"]["template_id"], "project_workspace")
        self.assertEqual(kwargs["strategy"]["language"], "en")
        self.assertEqual(kwargs["strategy"]["density"], "normal")
        self.assertEqual(kwargs["strategy"]["prefix_style"], "none")

    def test_fail_async_scan_event_includes_interrupted_snapshot(self):
        service = OrganizerSessionService(self.store, scanner=ImmediateScanner())
        created = service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None

        def broken_analysis(_target_dir, event_handler=None):
            raise RuntimeError("scanner boom")

        with mock.patch(
            "file_pilot.app.session_service.analysis_service.run_analysis_cycle",
            side_effect=broken_analysis,
        ):
            service.start_scan(session.session_id)

        error_events = [event for event in service.read_events(session.session_id) if event["event_type"] == "session.error"]
        self.assertTrue(error_events)
        latest = error_events[-1]
        self.assertEqual(latest["stage"], "interrupted")
        self.assertEqual(latest["session_snapshot"]["stage"], "interrupted")
        self.assertEqual(latest["session_snapshot"]["scanner_progress"]["status"], "failed")
        self.assertEqual(latest["session_snapshot"]["last_error"], "scanner boom")

    def test_auto_plan_failure_logs_exception_and_debug_event(self):
        log_dir = self.root / "logs" / "backend"
        setup_backend_logging(log_dir=log_dir)
        debug_path = self.root / "logs" / "backend" / "debug.jsonl"
        service = OrganizerSessionService(self.store, scanner=ImmediateScanner())
        created = service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None

        with mock.patch(
            "file_pilot.app.session_service.analysis_service.run_analysis_cycle",
            return_value="a.txt | 文档 | A",
        ), mock.patch(
            "file_pilot.app.session_service.organize_service.build_initial_messages",
            return_value=[{"role": "system", "content": "scan"}],
        ), mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
            side_effect=RuntimeError("planner boom"),
        ), mock.patch(
            "file_pilot.shared.logging_utils.DEBUG_LOG_PATH",
            debug_path,
        ), mock.patch(
            "file_pilot.shared.logging_utils.is_debug_logging_enabled",
            return_value=True,
        ), mock.patch(
            "file_pilot.app.session_orchestrator.logger.exception",
        ) as logger_exception:
            service.start_scan(session.session_id)

        reloaded = self.store.load(session.session_id)
        self.assertIsNotNone(reloaded)
        assert reloaded is not None
        self.assertEqual(reloaded.stage, "interrupted")
        self.assertIn("自动规划失败", reloaded.last_error)
        self.assertEqual(reloaded.planner_progress["status"], "failed")
        self.assertEqual(reloaded.planner_progress["message"], "本轮方案更新失败")
        logger_exception.assert_called()

        content = (log_dir / "runtime.log").read_text(encoding="utf-8")
        self.assertIn("plan.auto_started", content)
        self.assertIn("plan.auto_failed", content)
        debug_lines = [json.loads(line) for line in debug_path.read_text(encoding="utf-8").splitlines() if line.strip()]
        self.assertIn("plan.auto_failed", [entry["kind"] for entry in debug_lines])

    def test_start_scan_auto_plans_for_multi_source_sync_path(self):
        service = OrganizerSessionService(self.store, scanner=ImmediateScanner())
        extra_file = self.root / "loose.txt"
        extra_file.write_text("note", encoding="utf-8")
        created = service.create_session(
            [
                {"source_type": "directory", "path": str(self.target_dir)},
                {"source_type": "file", "path": str(extra_file)},
            ],
            resume_if_exists=False,
            organize_method="categorize_into_new_structure",
            strategy={
                "template_id": "general_downloads",
                "organize_method": "categorize_into_new_structure",
            },
            output_dir=str(self.target_dir),
        )
        session = created.session
        assert session is not None

        with mock.patch(
            "file_pilot.app.session_service.analysis_service.run_analysis_cycle_for_entry_context",
            return_value="a.txt | 文档 | A",
        ), mock.patch(
            "file_pilot.app.session_service.organize_service.build_initial_messages",
            return_value=[{"role": "system", "content": "scan"}],
        ), mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
        ) as organizer_cycle_mock:
            organizer_cycle_mock.return_value = (
                "已生成方案",
                {
                    "pending_plan": PendingPlan(
                        moves=[PlanMove(source="a.txt", target="Docs/a.txt")],
                        unresolved_items=[],
                        summary="已规划 1 项",
                    ),
                    "assistant_message": {"role": "assistant", "content": "已生成方案"},
                },
            )
            service.start_scan(session.session_id)

        reloaded = service.store.load(session.session_id)
        self.assertIsNotNone(reloaded)
        assert reloaded is not None
        organizer_cycle_mock.assert_called_once()
        self.assertEqual(reloaded.stage, "ready_for_precheck")
        self.assertEqual(reloaded.assistant_message["content"], "已生成方案")

    def test_start_scan_auto_plans_for_incremental_session_with_preselected_targets(self):
        service = OrganizerSessionService(self.store, scanner=ImmediateScanner())
        created = service.create_session(
            [{"source_type": "directory", "path": str(self.target_dir)}],
            resume_if_exists=False,
            organize_method="assign_into_existing_categories",
            strategy={
                "template_id": "general_downloads",
                "organize_method": "assign_into_existing_categories",
                "organize_mode": "incremental",
            },
            target_directories=[str(self.target_dir)],
        )
        session = created.session
        assert session is not None

        with mock.patch(
            "file_pilot.app.session_service.analysis_service.run_analysis_cycle",
            return_value="invoice.pdf | 财务票据 | 发票",
        ), mock.patch(
            "file_pilot.app.session_service.analysis_service.run_analysis_cycle_for_entries",
            return_value="invoice.pdf | 财务票据 | 发票",
        ), mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
            return_value=(
                "已生成归入方案",
                {
                    "pending_plan": PendingPlan(
                        moves=[PlanMove(source="invoice.pdf", target="Review/invoice.pdf")],
                        unresolved_items=[],
                        summary="已规划 1 项",
                    ),
                    "assistant_message": {"role": "assistant", "content": "已生成归入方案"},
                },
            ),
        ):
            service.start_scan(session.session_id)

        reloaded = service.store.load(session.session_id)
        self.assertIsNotNone(reloaded)
        assert reloaded is not None
        self.assertEqual(reloaded.stage, "ready_for_precheck")
        self.assertIn("1 项", reloaded.summary)
        self.assertEqual(reloaded.assistant_message["content"], "已生成归入方案")

    def test_start_scan_runs_real_analysis_for_file_sources(self):
        service = OrganizerSessionService(self.store, scanner=ImmediateScanner())
        source_file = self.root / "plan.md"
        source_file.write_text("# architecture", encoding="utf-8")
        created = service.create_session(
            [{"source_type": "file", "path": str(source_file)}],
            resume_if_exists=False,
            organize_method="categorize_into_new_structure",
            strategy={
                "template_id": "general_downloads",
                "organize_method": "categorize_into_new_structure",
            },
            output_dir=str(self.target_dir),
        )
        session = created.session
        assert session is not None

        with mock.patch(
            "file_pilot.app.session_service.analysis_service.run_analysis_cycle_for_entry_context",
            return_value="plan.md | file | 技术设计 | 架构设计文档",
        ), mock.patch(
            "file_pilot.app.session_service.organize_service.build_initial_messages",
            return_value=[{"role": "system", "content": "scan"}],
        ), mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
            return_value=(
                "已生成方案",
                {
                    "pending_plan": PendingPlan(
                        moves=[PlanMove(source="plan.md", target="Docs/plan.md")],
                        unresolved_items=[],
                        summary="已规划 1 项",
                    ),
                    "assistant_message": {"role": "assistant", "content": "已生成方案"},
                },
            ),
        ):
            service.start_scan(session.session_id)

        reloaded = service.store.load(session.session_id)
        assert reloaded is not None
        self.assertIn("plan.md | file | 技术设计 | 架构设计文档", reloaded.scan_lines)
        self.assertEqual(reloaded.planner_items[0]["suggested_purpose"], "技术设计")
        self.assertEqual(reloaded.planner_items[0]["summary"], "架构设计文档")

    def test_get_snapshot_recovers_orphaned_scanning_session_to_interrupted(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "scanning"
        self.store.save(session)
        session.updated_at = "2000-01-01T00:00:00+00:00"
        (self.store.sessions_dir / f"{session.session_id}.json").write_text(
            json.dumps(session.to_dict(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        snapshot = self.service.get_snapshot(session.session_id)

        self.assertEqual(snapshot["stage"], "interrupted")
        self.assertEqual(snapshot["integrity_flags"]["interrupted_during"], "scanning")
        self.assertEqual(snapshot["last_error"], "scanning_interrupted")

    def test_get_snapshot_keeps_recent_scanning_session_active(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "scanning"
        self.store.save(session)

        snapshot = self.service.get_snapshot(session.session_id)

        self.assertEqual(snapshot["stage"], "scanning")
        self.assertNotIn("interrupted_during", snapshot["integrity_flags"])

    def test_get_snapshot_keeps_registered_sync_scanning_session_active(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "scanning"
        session.updated_at = "2000-01-01T00:00:00+00:00"
        self.store.save(session)
        self.service._mark_scan_active(session.session_id)
        try:
            snapshot = self.service.get_snapshot(session.session_id)
        finally:
            self.service._mark_scan_inactive(session.session_id)

        self.assertEqual(snapshot["stage"], "scanning")
        self.assertNotIn("interrupted_during", snapshot["integrity_flags"])

    def test_list_history_recovers_orphaned_locked_session(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "executing"
        session.last_error = None
        self.store.save(session)

        history = self.service.list_history()

        matched = next(item for item in history if item["execution_id"] == session.session_id)
        reloaded = self.store.load(session.session_id)
        assert reloaded is not None
        self.assertEqual(matched["status"], "interrupted")
        self.assertTrue(matched["is_session"])
        self.assertEqual(reloaded.stage, "interrupted")
        self.assertEqual(reloaded.integrity_flags["interrupted_during"], "executing")
        self.assertEqual(reloaded.last_error, "executing_interrupted")

    def test_delete_history_entry_removes_session_file_and_latest_index(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None

        result = self.service.delete_history_entry(session.session_id)

        self.assertEqual(result["status"], "deleted")
        self.assertEqual(result["entry_type"], "session")
        self.assertIsNone(self.store.load(session.session_id))
        self.assertIsNone(self.store.find_latest_by_directory(self.target_dir))

    def test_update_item_target_uses_target_dir_and_removes_unresolved_item(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.pending_plan = {
            "directories": ["Review"],
            "moves": [{"source": "md", "target": "Review/md"}],
            "unresolved_items": ["md"],
            "summary": "needs review",
        }
        session.last_ai_pending_plan = {
            "directories": ["Review"],
            "moves": [{"source": "md", "target": "Review/md", "raw": ""}],
            "user_constraints": [],
            "unresolved_items": ["md"],
            "summary": "",
        }
        self.store.save(session)

        result = self.service.update_item_target(
            session.session_id,
            "md",
            "Study",
            None,
            False,
        )

        updated_item = next(
            item for item in result.session_snapshot["plan_snapshot"]["items"] if item["source_relpath"] == "md"
        )
        self.assertNotIn("target_relpath", updated_item)
        self.assertEqual(self._plan_item_target_directory(result.session_snapshot, "md"), "Study")
        self.assertEqual(result.session_snapshot["plan_snapshot"]["unresolved_items"], [])
        self.assertEqual(result.session_snapshot["plan_snapshot"]["stats"]["unresolved_count"], 0)
        self.assertEqual(result.session_snapshot["messages"][-1]["visibility"], "internal")
        self.assertIn("[用户手动调整记录]", result.session_snapshot["messages"][-1]["content"])
        self.assertEqual(result.session_snapshot["summary"], "已分类 1 项，调整 1 项，仍剩 0 项待定")
        self.assertEqual(result.session_snapshot["plan_snapshot"]["summary"], "已分类 1 项，调整 1 项，仍剩 0 项待定")

    def test_update_item_target_move_to_review_removes_unresolved_item_immediately(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "md", "target": "Docs/md"}],
            "unresolved_items": ["md"],
            "summary": "needs confirmation",
        }
        session.last_ai_pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "md", "target": "Docs/md", "raw": ""}],
            "user_constraints": [],
            "unresolved_items": ["md"],
            "summary": "",
        }
        self.store.save(session)

        result = self.service.update_item_target(
            session.session_id,
            "md",
            None,
            None,
            True,
        )

        updated_item = next(
            item for item in result.session_snapshot["plan_snapshot"]["items"] if item["source_relpath"] == "md"
        )
        self.assertNotIn("target_relpath", updated_item)
        self.assertEqual(updated_item["target_slot_id"], "Review")
        self.assertEqual(self._plan_item_target_directory(result.session_snapshot, "md"), "Review")
        self.assertEqual(updated_item["status"], "review")
        self.assertEqual(result.session_snapshot["plan_snapshot"]["unresolved_items"], [])
        self.assertEqual(result.session_snapshot["summary"], "已分类 1 项，调整 1 项，仍剩 0 项待定")
        self.assertEqual(result.session_snapshot["plan_snapshot"]["summary"], "已分类 1 项，调整 1 项，仍剩 0 项待定")

    def test_plan_snapshot_uses_empty_target_slot_id_for_keep_in_place_move(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.pending_plan = {
            "directories": [],
            "moves": [{"source": "md", "target": "md"}],
            "unresolved_items": [],
            "summary": "keep in place",
        }
        self.store.save(session)

        snapshot = self.service.get_snapshot(session.session_id)
        item = snapshot["plan_snapshot"]["items"][0]
        mapping = snapshot["plan_snapshot"]["mappings"][0]

        self.assertEqual(item["target_slot_id"], "")
        self.assertEqual(item["mapping_status"], "skipped")
        self.assertEqual(mapping["target_slot_id"], "")
        self.assertEqual(mapping["status"], "skipped")

    def test_update_item_target_accepts_target_slot_and_snapshot_exposes_structured_targets(self):
        created = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            strategy={"organize_mode": "incremental", "destination_index_depth": 2},
        )
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.scan_lines = "md | file | 学习资料 | 笔记"
        session.incremental_selection = {
            "required": True,
            "status": "ready",
            "destination_index_depth": 2,
            "root_directory_options": ["Docs", "Inbox"],
            "target_directories": ["Docs"],
            "target_directory_tree": [{"relpath": "Docs", "name": "Docs", "children": []}],
            "pending_items_count": 1,
            "source_scan_completed": True,
        }
        session.pending_plan = {
            "directories": ["Review"],
            "moves": [{"source": "md", "target": "Review/md"}],
            "unresolved_items": ["md"],
            "summary": "needs review",
        }
        session.last_ai_pending_plan = {
            "directories": ["Review"],
            "moves": [{"source": "md", "target": "Review/md", "raw": ""}],
            "user_constraints": [],
            "unresolved_items": ["md"],
            "summary": "",
        }
        self.store.save(session)

        result = self.service.update_item_target(
            session.session_id,
            "md",
            None,
            "D001",
            False,
        )

        updated_item = next(
            item for item in result.session_snapshot["plan_snapshot"]["items"] if item["source_relpath"] == "md"
        )
        self.assertNotIn("target_relpath", updated_item)
        self.assertEqual(updated_item["target_slot_id"], "D001")
        self.assertEqual(self._plan_item_target_directory(result.session_snapshot, "md"), "Docs")
        self.assertEqual(
            [slot["relpath"] for slot in result.session_snapshot["plan_snapshot"]["target_slots"]],
            ["Docs"],
        )
        self.assertEqual(result.session_snapshot["plan_snapshot"]["mappings"][0]["target_slot_id"], "D001")
        reloaded = self.store.load(session.session_id)
        assert reloaded is not None
        self.assertIsInstance(reloaded.task_state, TaskState)
        self.assertEqual(reloaded.task_state.mappings[0].target_slot_id, "D001")

    def test_update_item_target_accepts_absolute_target_slot_outside_workspace_root(self):
        docs_dir = self.target_dir / "Docs"
        archive_dir = self.root / "Archive"
        docs_dir.mkdir(parents=True, exist_ok=True)
        archive_dir.mkdir(parents=True, exist_ok=True)

        created = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            strategy={"organize_mode": "incremental", "destination_index_depth": 1},
            organize_method="assign_into_existing_categories",
            target_directories=[str(docs_dir), str(archive_dir)],
        )
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.target_dir = str(docs_dir.resolve())
        session.scan_lines = "md | file | 学习资料 | 笔记"
        session.incremental_selection = {
            "required": True,
            "status": "ready",
            "destination_index_depth": 1,
            "root_directory_options": [str(docs_dir.resolve()), str(archive_dir.resolve())],
            "target_directories": [str(docs_dir.resolve()), str(archive_dir.resolve())],
            "target_directory_tree": [
                {"relpath": str(docs_dir.resolve()), "name": "Docs", "children": []},
                {"relpath": str(archive_dir.resolve()), "name": "Archive", "children": []},
            ],
            "pending_items_count": 1,
            "source_scan_completed": True,
        }
        session.pending_plan = {
            "directories": ["Review"],
            "moves": [{"source": "md", "target": "Review/md"}],
            "unresolved_items": ["md"],
            "summary": "needs review",
        }
        self.store.save(session)

        result = self.service.update_item_target(
            session.session_id,
            "md",
            None,
            "D002",
            False,
        )

        self.assertEqual(
            self._plan_item_target_directory(result.session_snapshot, "md").replace("\\", "/"),
            str(archive_dir.resolve()).replace("\\", "/"),
        )
        updated_item = next(
            item for item in result.session_snapshot["plan_snapshot"]["items"] if item["source_relpath"] == "md"
        )
        self.assertEqual(updated_item["target_slot_id"], "D002")

    def test_run_planner_cycle_stores_structured_last_ai_pending_plan(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.scan_lines = "md | file | 学习资料 | 笔记"
        self.store.save(session)

        updated_pending = PendingPlan(
            directories=["Docs"],
            moves=[PlanMove(source="md", target="Docs/md")],
            unresolved_items=[],
            summary="已分类 1 项",
        )

        with mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
            return_value=(
                "已改为 Docs",
                {
                    "pending_plan": updated_pending,
                    "is_valid": False,
                    "diff_summary": ["调整移动：md -> Docs/md"],
                    "assistant_message": {"role": "assistant", "content": "已改为 Docs"},
                },
            ),
        ):
            self.service.submit_user_intent(session.session_id, "改到 Docs")

        reloaded = self.store.load(session.session_id)
        assert reloaded is not None
        self.assertIsNotNone(reloaded.last_ai_pending_plan)
        assert reloaded.last_ai_pending_plan is not None
        self.assertIsInstance(reloaded.last_ai_pending_plan.pending_plan, PendingPlanPayload)
        self.assertIsInstance(reloaded.last_ai_pending_plan.plan_snapshot, PlanSnapshotPayload)
        self.assertIsInstance(reloaded.task_state, TaskState)
        self.assertEqual(reloaded.task_state.mappings[0].target_slot_id, "D001")
        self.assertEqual(
            reloaded.last_ai_pending_plan.plan_snapshot["items"][0]["target_slot_id"],
            "D001",
        )

    def test_get_snapshot_normalizes_legacy_last_ai_pending_plan_shape(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.scan_lines = "md | file | 学习资料 | 笔记"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "md", "target": "Docs/md"}],
            "unresolved_items": [],
            "summary": "已分类 1 项",
        }
        session.last_ai_pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "md", "target": "Docs/md", "raw": ""}],
            "user_constraints": [],
            "unresolved_items": [],
            "summary": "已分类 1 项",
        }
        self.store.save(session)

        self.service.get_snapshot(session.session_id)

        reloaded = self.store.load(session.session_id)
        assert reloaded is not None
        self.assertIsNotNone(reloaded.last_ai_pending_plan)
        assert reloaded.last_ai_pending_plan is not None
        self.assertEqual(reloaded.last_ai_pending_plan.schema_version, 1)
        self.assertEqual(
            reloaded.last_ai_pending_plan.pending_plan["moves"][0]["target"],
            "Docs/md",
        )
        self.assertIn("plan_snapshot", reloaded.last_ai_pending_plan.to_dict())

    def test_submit_user_intent_clears_previous_manual_sync_message_after_ai_plan(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.scan_lines = "md | file | 学习资料 | 笔记"
        session.pending_plan = {
            "directories": ["Study"],
            "moves": [{"source": "md", "target": "Study/md"}],
            "unresolved_items": [],
            "summary": "已分类 1 项，调整 1 项，仍剩 0 项待定",
        }
        session.messages = [
            {"role": "system", "content": "prompt"},
            {
                "role": "user",
                "content": "[用户手动调整记录]\n用户在预览区域对方案进行了如下手动调整：\n- 调整移动：md -> Study/md",
                "visibility": "internal",
            },
        ]
        session.last_ai_pending_plan = {
            "directories": [""],
            "moves": [{"source": "md", "target": "md", "raw": ""}],
            "user_constraints": [],
            "unresolved_items": [],
            "summary": "",
        }
        self.store.save(session)

        updated_pending = PendingPlan(
            directories=["Docs"],
            moves=[PlanMove(source="md", target="Docs/md")],
            unresolved_items=[],
            summary="",
        )

        with mock.patch(
            "file_pilot.app.session_service.organize_service.run_organizer_cycle",
            return_value=(
                "已改为 Docs",
                {
                    "pending_plan": updated_pending,
                    "is_valid": False,
                    "diff_summary": ["调整移动：md -> Docs/md"],
                    "assistant_message": {"role": "assistant", "content": "已改为 Docs"},
                },
            ),
        ):
            result = self.service.submit_user_intent(session.session_id, "改到 Docs")

        internal_sync_messages = [
            message for message in result.session_snapshot["messages"]
            if message.get("visibility") == "internal" and "[用户手动调整记录]" in message.get("content", "")
        ]
        self.assertEqual(internal_sync_messages, [])
        self.assertEqual(result.session_snapshot["summary"], "已分类 1 项，调整 1 项，仍剩 0 项待定")

    def test_refresh_session_rebuilds_plan_and_marks_invalidated_items(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "stale"
        (self.target_dir / "a.txt").write_text("A", encoding="utf-8")
        (self.target_dir / "c.txt").write_text("C", encoding="utf-8")
        session.scan_lines = "a.txt | 文档 | A\nb.txt | 文档 | B"
        session.pending_plan = {
            "directories": ["Docs", "Review"],
            "moves": [
                {"source": "a.txt", "target": "Docs/a.txt"},
                {"source": "b.txt", "target": "Review/b.txt"},
            ],
            "unresolved_items": [],
            "summary": "old plan",
        }
        session.plan_snapshot = {
            "items": [
                {"item_id": "a.txt", "display_name": "a.txt", "source_relpath": "a.txt", "target_relpath": "Docs/a.txt", "status": "planned"},
                {"item_id": "b.txt", "display_name": "b.txt", "source_relpath": "b.txt", "target_relpath": "Review/b.txt", "status": "review"},
            ],
            "change_highlights": ["保留旧高亮"],
        }
        self.store.save(session)

        def fake_run_planner_cycle_for_session(active_session, **kwargs):
            rebuilt_pending = PendingPlan(
                directories=["Docs", "Images"],
                moves=[
                    PlanMove(source="a.txt", target="Docs/a.txt"),
                    PlanMove(source="c.txt", target="Images/c.txt"),
                ],
                unresolved_items=[],
                summary="rebuilt plan",
            )
            active_session.pending_plan = self.service._pending_plan_payload(rebuilt_pending)
            active_session.plan_snapshot = self.service._plan_snapshot_payload(
                self.service._plan_snapshot(
                    rebuilt_pending,
                    {"diff_summary": ["refresh"]},
                    scan_lines=active_session.scan_lines,
                    planner_items=active_session.planner_items,
                    session=active_session,
                )
            )
            active_session.summary = rebuilt_pending.summary
            active_session.assistant_message = {"role": "assistant", "content": "rebuilt"}

        with mock.patch.object(
            self.service.orchestrator,
            "run_planner_cycle_for_session",
            side_effect=fake_run_planner_cycle_for_session,
        ):
            result = self.service.refresh_session(
                session.session_id,
                scan_runner=lambda path: "a.txt | 文档 | A\nc.txt | 图片 | C",
            )

        self.assertEqual(result.session_snapshot["stage"], "ready_for_precheck")
        self.assertEqual(result.session_snapshot["integrity_flags"]["is_stale"], False)
        self.assertEqual(
            [item["item_id"] for item in result.session_snapshot["plan_snapshot"]["invalidated_items"]],
            ["F002"],
        )
        self.assertEqual(
            result.session_snapshot["plan_snapshot"]["invalidated_items"][0]["mapping_status"],
            "invalidated",
        )
        self.assertNotIn(
            "target_relpath",
            result.session_snapshot["plan_snapshot"]["invalidated_items"][0],
        )
        self.assertEqual(
            result.session_snapshot["plan_snapshot"]["change_highlights"],
            ["保留旧高亮"],
        )
        reloaded = self.store.load(session.session_id)
        self.assertIsInstance(reloaded.pending_plan, PendingPlanPayload)
        self.assertEqual(
            [move["source"] for move in reloaded.pending_plan["moves"]],
            ["a.txt", "c.txt"],
        )

    def test_refresh_session_rejects_non_recovery_stage(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        self.store.save(session)

        with self.assertRaisesRegex(RuntimeError, "SESSION_STAGE_CONFLICT"):
            self.service.refresh_session(session.session_id, scan_runner=lambda path: "")

    def test_refresh_session_allows_empty_completed_session_and_keeps_completed_state(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "completed"
        session.summary = "当前目录为空，无需整理"
        session.integrity_flags["empty_scan_result"] = True
        session.pending_plan = {}
        session.plan_snapshot = {}
        self.store.save(session)

        result = self.service.refresh_session(session.session_id, scan_runner=lambda path: "")

        self.assertEqual(result.session_snapshot["stage"], "completed")
        self.assertTrue(result.session_snapshot["integrity_flags"]["empty_scan_result"])

    def test_resume_session_does_not_mark_stale_for_multi_source_scope_without_changes(self):
        source_root = self.root / "sources"
        source_a = source_root / "Alpha"
        source_b = source_root / "Beta"
        source_a.mkdir(parents=True, exist_ok=True)
        source_b.mkdir(parents=True, exist_ok=True)
        (source_a / "a.txt").write_text("A", encoding="utf-8")
        (source_b / "b.txt").write_text("B", encoding="utf-8")
        output_dir = self.root / "output"
        output_dir.mkdir(parents=True, exist_ok=True)

        created = self.service.create_session(
            [
                {"source_type": "directory", "path": str(source_a), "directory_mode": "contents"},
                {"source_type": "directory", "path": str(source_b), "directory_mode": "contents"},
            ],
            resume_if_exists=False,
            organize_method="categorize_into_new_structure",
            strategy={"template_id": "general_downloads"},
            output_dir=str(output_dir),
        )
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.scan_lines = self.service._current_scope_scan_lines(session)
        self.store.save(session)

        resumed = self.service.resume_session(session.session_id)

        self.assertEqual(resumed.stage, "planning")
        self.assertIsNone(resumed.stale_reason)

    def test_resume_session_does_not_mark_stale_for_incremental_pending_scope_without_changes(self):
        (self.target_dir / "Projects").mkdir()
        (self.target_dir / "todo.txt").write_text("todo", encoding="utf-8")
        created = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            strategy={"organize_mode": "incremental", "destination_index_depth": 2},
        )
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.selected_target_directories = ["Projects"]
        session.incremental_selection = {
            **self.service._incremental_selection_defaults(session),
            "status": "ready",
            "root_directory_options": ["Projects"],
            "target_directories": ["Projects"],
            "target_directory_tree": [{"relpath": "Projects", "name": "Projects", "children": []}],
            "pending_items_count": 1,
            "source_scan_completed": True,
        }
        session.scan_lines = "todo.txt | file | 待处理 | 待整理"
        self.store.save(session)

        resumed = self.service.resume_session(session.session_id)

        self.assertEqual(resumed.stage, "planning")
        self.assertIsNone(resumed.stale_reason)

    def test_refresh_session_keeps_existing_strategy_summary(self):
        created = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            strategy={
                "template_id": "study_materials",
                "language": "zh",
                "density": "normal",
                "prefix_style": "none",
                "caution_level": "conservative",
                "note": "模糊项都进待确认",
            },
        )
        session = created.session
        assert session is not None
        session.stage = "stale"
        session.scan_lines = "a.txt | 文档 | A"
        session.pending_plan = {
            "directories": ["课程资料"],
            "moves": [{"source": "a.txt", "target": "课程资料/a.txt"}],
            "unresolved_items": [],
            "summary": "old plan",
            "user_constraints": ["模糊项都进待确认"],
        }
        self.store.save(session)

        with mock.patch.object(self.service.orchestrator, "run_planner_cycle_for_session"):
            result = self.service.refresh_session(
                session.session_id,
                scan_runner=lambda path: "a.txt | 文档 | A",
            )

        self.assertEqual(result.session_snapshot["strategy"]["template_id"], "study_materials")
        self.assertEqual(result.session_snapshot["strategy"]["caution_level"], "conservative")
        self.assertEqual(result.session_snapshot["strategy"]["note"], "模糊项都进待确认")

    def test_get_snapshot_keeps_frozen_target_directory_details_after_profile_changes(self):
        profile = self.service.target_profiles.create(
            "办公目录池",
            [
                {"path": str(self.target_dir / "Docs"), "label": "文档", "description": "旧说明"},
            ],
        )
        created = self.service.create_session(
            [{"source_type": "directory", "path": str(self.target_dir)}],
            resume_if_exists=False,
            organize_method="assign_into_existing_categories",
            strategy={"template_id": "general_downloads"},
            target_profile_id=profile.profile_id,
        )
        session = created.session
        assert session is not None
        self.assertEqual(
            [item.description for item in session.selected_target_directory_details],
            ["旧说明"],
        )

        self.service.target_profiles.update(
            profile.profile_id,
            directories=[
                {"path": str(self.target_dir / "Docs"), "label": "文档", "description": "新说明"},
            ],
        )

        snapshot = self.service.get_snapshot(session.session_id)

        self.assertEqual(
            snapshot["strategy"]["target_directory_details"],
            [
                {
                    "path": str(self.target_dir / "Docs"),
                    "label": "文档",
                    "description": "旧说明",
                }
            ],
        )

    def test_get_snapshot_backfills_legacy_plan_groups_from_pending_moves(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "ready_for_precheck"
        session.summary = "已分类 2 项"
        session.pending_plan = {
            "directories": ["学习资料", "项目资料"],
            "moves": [
                {"source": "a.txt", "target": "学习资料/a.txt"},
                {"source": "b.zip", "target": "项目资料/b.zip"},
            ],
            "unresolved_items": [],
            "summary": "已分类 2 项",
        }
        session.plan_snapshot = {
            "summary": "已分类 2 项",
            "stats": {"move_count": 2, "unresolved_count": 0, "directory_count": 2},
            "groups": [],
            "items": [
                {"item_id": "a.txt", "display_name": "a.txt", "source_relpath": "a.txt", "target_relpath": "学习资料/a.txt", "is_unresolved": False, "reason": ""},
                {"item_id": "b.zip", "display_name": "b.zip", "source_relpath": "b.zip", "target_relpath": "项目资料/b.zip", "is_unresolved": False, "reason": ""},
            ],
            "unresolved_items": [],
            "review_items": [],
            "invalidated_items": [],
            "diff_summary": [],
            "readiness": {"can_precheck": True},
        }
        self.store.save(session)

        snapshot = self.service.get_snapshot(session.session_id)

        self.assertEqual(
            [group["directory"] for group in snapshot["plan_snapshot"]["groups"]],
            ["学习资料", "项目资料"],
        )
        self.assertEqual(
            [item["status"] for item in snapshot["plan_snapshot"]["items"]],
            ["planned", "planned", "planned", "planned"],
        )
        self.assertTrue(all("target_relpath" not in item for item in snapshot["plan_snapshot"]["items"]))

    def test_plan_snapshot_items_include_scan_purpose_and_summary(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        (self.target_dir / "md").mkdir()
        (self.target_dir / "notes.txt").write_text("note", encoding="utf-8")
        session.scan_lines = "md | dir | 工具报告 | 含一次 Organizer 扫描报告\nnotes.txt | file | 学习笔记 | 课程随手记录"
        session.pending_plan = {
            "directories": ["历史归档", "学习资料"],
            "moves": [
                {"source": "md", "target": "历史归档/md"},
                {"source": "notes.txt", "target": "学习资料/notes.txt"},
            ],
            "unresolved_items": [],
            "summary": "已分类 2 项",
        }
        self.store.save(session)

        snapshot = self.service.get_snapshot(session.session_id)
        md_item = next(item for item in snapshot["plan_snapshot"]["items"] if item["source_relpath"] == "md")
        notes_item = next(item for item in snapshot["plan_snapshot"]["items"] if item["source_relpath"] == "notes.txt")

        self.assertEqual(md_item["suggested_purpose"], "工具报告")
        self.assertEqual(md_item["content_summary"], "含一次 Organizer 扫描报告")
        self.assertEqual(md_item["entry_type"], "dir")
        self.assertEqual(notes_item["suggested_purpose"], "学习笔记")
        self.assertEqual(notes_item["content_summary"], "课程随手记录")
        self.assertEqual(notes_item["entry_type"], "file")

    def test_scan_entries_preserves_explicit_directory_type_for_dotted_directory(self):
        entries = self.service._scan_entries("project.v1 | dir | 项目目录 | 多版本资料")

        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["source_relpath"], "project.v1")
        self.assertEqual(entries[0]["entry_type"], "dir")

    def test_get_snapshot_uses_planner_ids_for_plan_items_when_scan_lines_exist(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.scan_lines = "a.txt | 文档 | A"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "a.txt", "target": "Docs/a.txt"}],
            "unresolved_items": [],
            "summary": "done",
        }
        self.store.save(session)

        snapshot = self.service.get_snapshot(session.session_id)
        item = snapshot["plan_snapshot"]["items"][0]

        self.assertTrue(item["item_id"].startswith("F"))
        self.assertEqual(item["source_relpath"], "a.txt")

    def test_get_snapshot_marks_legacy_active_session_stale_when_schema_is_old(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.planning_schema_version = 1
        session.stage = "planning"
        session.scan_lines = "a.txt | 文档 | A"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "a.txt", "target": "Docs/a.txt"}],
            "unresolved_items": [],
            "summary": "legacy",
        }
        session.planner_items = []
        self.store.save(session)

        snapshot = self.service.get_snapshot(session.session_id)

        self.assertEqual(snapshot["stage"], "stale")
        self.assertEqual(snapshot["stale_reason"], "planning_schema_incompatible")

    def test_get_snapshot_preserves_source_tree_entries_across_stage_changes_and_legacy_fallback(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        (self.target_dir / "assets").mkdir()
        (self.target_dir / "assets" / "cover.png").write_text("img", encoding="utf-8")
        session.scan_lines = "assets | dir | 图片目录 | 原始目录\nassets/cover.png | file | 图片素材 | 封面"
        session.planner_items = self.service._build_planner_items(session.scan_lines)
        session.stage = "ready_for_precheck"
        session.source_tree_entries = []
        self.store.save(session)

        ready_snapshot = self.service.get_snapshot(session.session_id)
        expected_entries = [
            {"source_relpath": "assets", "display_name": "assets", "entry_type": "directory"},
            {"source_relpath": "assets/cover.png", "display_name": "cover.png", "entry_type": "file"},
        ]

        self.assertEqual(ready_snapshot["source_tree_entries"], expected_entries)

        session = self.store.load(session.session_id)
        assert session is not None
        session.planning_schema_version = 1
        session.stage = "planning"
        session.source_tree_entries = []
        self.store.save(session)

        stale_snapshot = self.service.get_snapshot(session.session_id)

        self.assertEqual(stale_snapshot["stage"], "stale")
        self.assertEqual(stale_snapshot["source_tree_entries"], expected_entries)

    def test_refresh_session_rejects_locked_stage(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "executing"
        self.store.save(session)

        with self.assertRaisesRegex(RuntimeError, "SESSION_STAGE_CONFLICT"):
            self.service.refresh_session(session.session_id, scan_runner=lambda path: "")

    def test_refresh_session_marks_interrupted_when_scan_returns_empty_for_nonempty_directory(self):
        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "stale"
        session.scan_lines = "a.txt | 文档 | A"
        self.store.save(session)

        with self.assertRaisesRegex(RuntimeError, "scan_empty_result"):
            self.service.refresh_session(session.session_id, scan_runner=lambda path, session_id=None: "")

        reloaded = self.store.load(session.session_id)
        self.assertIsNotNone(reloaded)
        assert reloaded is not None
        self.assertEqual(reloaded.stage, "interrupted")
        self.assertEqual(reloaded.last_error, "scan_empty_result")

    def test_finish_async_scan_ignores_non_scanning_sessions(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "stale"
        self.store.save(session)

        self.service._finish_async_scan(session.session_id, "a.txt | 文档 | A")
        reloaded = self.store.load(session.session_id)

        self.assertEqual(reloaded.stage, "stale")
        self.assertEqual(reloaded.scan_lines, "")

    def test_empty_planning_snapshot_does_not_rebuild_plan_snapshot(self):
        source_items = []
        scan_entries = []
        for index in range(30):
            path = self.target_dir / f"item-{index}.txt"
            path.write_text("hello", encoding="utf-8")
            source_items.append(SourceCollectionItem(source_type="file", path=str(path)))
            scan_entries.append(f"item-{index}.txt | file | 文档 | 测试文件")

        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.source_collection = source_items
        session.scan_lines = "\n".join(scan_entries)
        session.planner_items = self.service._build_planner_items(session.scan_lines)
        session.pending_plan = PendingPlanPayload()
        session.plan_snapshot = {
            "summary": "",
            "stats": {"move_count": 0, "unresolved_count": 0, "directory_count": 0},
            "groups": [],
            "items": [],
            "unresolved_items": [],
            "review_items": [],
            "invalidated_items": [],
            "diff_summary": [],
            "change_highlights": [],
            "target_slots": [],
            "mappings": [],
            "readiness": {"can_precheck": False},
        }

        with mock.patch.object(self.service, "_plan_snapshot", side_effect=AssertionError("empty plan should not rebuild")):
            snapshot = self.service._build_snapshot(session)

        self.assertEqual(snapshot["stage"], "planning")
        self.assertEqual(len(snapshot["source_tree_entries"]), 30)
        self.assertEqual(snapshot["plan_snapshot"]["items"], [])

    def test_get_journal_summary_returns_latest_execution_details(self):
        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "ready_to_execute"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "a.txt", "target": "Docs/a.txt"}],
            "unresolved_items": [],
            "summary": "move to docs",
        }
        self.store.save(session)
        self.service.execute(session.session_id, confirm=True)

        summary = self.service.get_journal_summary(session.session_id)

        self.assertEqual(summary["status"], "completed")
        self.assertEqual(summary["item_count"], 2)
        self.assertEqual(summary["execution_id"], summary["journal_id"])
        self.assertEqual(summary["restore_items"], [])

    def test_get_journal_summary_prefers_latest_rollback_restore_mapping(self):
        (self.target_dir / "a.txt").write_text("hello", encoding="utf-8")
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "ready_to_execute"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [{"source": "a.txt", "target": "Docs/a.txt"}],
            "unresolved_items": [],
            "summary": "move to docs",
        }
        self.store.save(session)
        self.service.execute(session.session_id, confirm=True)
        self.service.rollback(session.session_id, confirm=True)

        summary = self.service.get_journal_summary(session.session_id)

        self.assertEqual(summary["status"], "rolled_back")
        self.assertEqual(len(summary["restore_items"]), 1)
        self.assertEqual(summary["restore_items"][0]["source"].replace("\\", "/").split("/")[-2:], ["Docs", "a.txt"])
        self.assertEqual(summary["restore_items"][0]["target"].replace("\\", "/").split("/")[-1], "a.txt")
        self.assertEqual(summary["restore_items"][0]["display_name"], "a.txt")
        self.assertEqual(summary["restore_items"][0]["item_id"], "F001")
        self.assertEqual(summary["restore_items"][0]["source_ref_id"], "F001")
        self.assertEqual(summary["restore_items"][0]["target_slot_id"], "D001")

    def test_cleanup_empty_dirs_returns_cleaned_count(self):
        docs_dir = self.target_dir / "Docs"
        docs_dir.mkdir(parents=True, exist_ok=True)
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        session.stage = "completed"
        session.pending_plan = {
            "directories": ["Docs"],
            "moves": [],
            "unresolved_items": [],
            "summary": "done",
        }
        session.execution_report = {
            "execution_id": "exec-1",
            "journal_id": "exec-1",
            "success_count": 0,
            "failure_count": 0,
            "status": "success",
            "has_cleanup_candidates": True,
            "cleanup_candidate_count": 1,
        }
        self.store.save(session)

        result = self.service.cleanup_empty_dirs(session.session_id)

        self.assertEqual(result["cleaned_count"], 1)
        self.assertFalse(docs_dir.exists())


if __name__ == "__main__":
    unittest.main()
