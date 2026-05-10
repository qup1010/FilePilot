import shutil
import time
import unittest
import os
from pathlib import Path
from unittest import mock

from fastapi.testclient import TestClient

from file_pilot.api.main import create_app
from file_pilot.app.session_service import OrganizerSessionService
from file_pilot.app.session_store import SessionStore


class SessionCreationV2Tests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_session_creation_v2")
        if self.root.exists():
            shutil.rmtree(self.root)
        self.sources_dir = self.root / "Sources"
        self.sources_dir.mkdir(parents=True, exist_ok=True)
        self.output_dir = self.root / "Output"
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.target_a = self.root / "CategoriesA"
        self.target_b = self.root / "CategoriesB"
        self.target_a.mkdir(parents=True, exist_ok=True)
        self.target_b.mkdir(parents=True, exist_ok=True)
        self.store = SessionStore(self.root / "sessions")
        self.service = OrganizerSessionService(self.store)
        self.client = TestClient(create_app(self.service))

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

    def test_post_sessions_accepts_sources_and_output_dir(self):
        response = self.client.post(
            "/api/sessions",
            json={
                "sources": [{"source_type": "directory", "path": str(self.sources_dir)}],
                "resume_if_exists": False,
                "organize_method": "categorize_into_new_structure",
                "output_dir": str(self.output_dir),
                "strategy": {
                    "template_id": "general_downloads",
                    "task_type": "organize_full_directory",
                    "organize_method": "categorize_into_new_structure",
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["session_snapshot"]["strategy"]["organize_method"], "categorize_into_new_structure")
        self.assertEqual(payload["session_snapshot"]["strategy"]["output_dir"], str(self.output_dir))

    def test_post_sessions_rejects_missing_output_dir_for_new_structure(self):
        response = self.client.post(
            "/api/sessions",
            json={
                "sources": [{"source_type": "directory", "path": str(self.sources_dir)}],
                "resume_if_exists": False,
                "organize_method": "categorize_into_new_structure",
                "strategy": {"template_id": "general_downloads"},
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error_code"], "OUTPUT_DIR_REQUIRED")

    def test_post_sessions_rejects_project_root_as_source(self):
        response = self.client.post(
            "/api/sessions",
            json={
                "sources": [{"source_type": "directory", "path": str(Path.cwd())}],
                "resume_if_exists": False,
                "organize_method": "categorize_into_new_structure",
                "output_dir": str(self.output_dir),
                "strategy": {
                    "template_id": "general_downloads",
                    "task_type": "organize_full_directory",
                    "organize_method": "categorize_into_new_structure",
                },
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error_code"], "SOURCE_PATH_PROJECT_ROOT")

    def test_post_sessions_accepts_target_directories_for_existing_categories(self):
        response = self.client.post(
            "/api/sessions",
            json={
                "sources": [{"source_type": "directory", "path": str(self.sources_dir)}],
                "resume_if_exists": False,
                "organize_method": "assign_into_existing_categories",
                "target_directories": [str(self.target_a), str(self.target_b)],
                "strategy": {
                    "template_id": "general_downloads",
                    "task_type": "organize_into_existing",
                    "organize_method": "assign_into_existing_categories",
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["session_snapshot"]["strategy"]["organize_method"], "assign_into_existing_categories")
        self.assertEqual(
            payload["session_snapshot"]["strategy"]["target_directories"],
            [str(self.target_a), str(self.target_b)],
        )

    def test_post_sessions_accepts_target_directory_details_for_existing_categories(self):
        response = self.client.post(
            "/api/sessions",
            json={
                "sources": [{"source_type": "directory", "path": str(self.sources_dir)}],
                "resume_if_exists": False,
                "organize_method": "assign_into_existing_categories",
                "target_directory_details": [
                    {
                        "path": str(self.target_a),
                        "label": "文档区",
                        "description": "适合合同、说明书、项目文档",
                    },
                    {
                        "path": str(self.target_b),
                        "label": "媒体区",
                        "description": "适合图片、视频和音频素材",
                    },
                ],
                "strategy": {
                    "template_id": "general_downloads",
                    "task_type": "organize_into_existing",
                    "organize_method": "assign_into_existing_categories",
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(
            payload["session_snapshot"]["strategy"]["target_directory_details"],
            [
                {
                    "path": str(self.target_a),
                    "label": "文档区",
                    "description": "适合合同、说明书、项目文档",
                },
                {
                    "path": str(self.target_b),
                    "label": "媒体区",
                    "description": "适合图片、视频和音频素材",
                },
            ],
        )

    def test_create_session_dedupes_sources_by_canonical_path_and_keeps_last_mode(self):
        source_dir = self.sources_dir / "SourceA"
        source_dir.mkdir(parents=True, exist_ok=True)
        first_path = str(source_dir)
        last_path = str(source_dir).upper() if os.name == "nt" else str(source_dir)

        created = self.service.create_session(
            [
                {"source_type": "directory", "path": first_path, "directory_mode": "contents"},
                {"source_type": "directory", "path": last_path.replace("\\", "/") + "/", "directory_mode": "atomic"},
            ],
            resume_if_exists=False,
            organize_method="categorize_into_new_structure",
            strategy={"template_id": "general_downloads"},
            output_dir=str(self.output_dir),
        )

        session = created.session
        assert session is not None
        self.assertEqual(len(session.source_collection), 1)
        self.assertEqual(session.source_collection[0].normalized_directory_mode, "atomic")
        self.assertTrue(session.source_collection[0].path.replace("\\", "/").rstrip("/").lower().endswith("sourcea"))

    def test_create_session_dedupes_target_directories_by_canonical_path_and_keeps_last_value(self):
        first_target = str(self.target_a)
        last_target = str(self.target_a).upper() if os.name == "nt" else str(self.target_a)

        created = self.service.create_session(
            [{"source_type": "directory", "path": str(self.sources_dir)}],
            resume_if_exists=False,
            organize_method="assign_into_existing_categories",
            strategy={"template_id": "general_downloads"},
            target_directories=[
                first_target,
                str(self.target_b).replace("\\", "/") + "/",
                last_target.replace("\\", "/") + "/",
            ],
        )

        session = created.session
        assert session is not None
        self.assertEqual(len(session.selected_target_directories), 2)
        self.assertEqual(session.selected_target_directories[-1].replace("\\", "/").rstrip("/"), last_target.replace("\\", "/"))
        snapshot = self.service.get_snapshot(session.session_id)
        self.assertEqual(
            snapshot["strategy"]["target_directories"],
            session.selected_target_directories,
        )

    def test_target_profile_crud_and_create_session_with_profile(self):
        created = self.client.post(
            "/api/target-profiles",
            json={
                "name": "办公目录池",
                "directories": [
                    {"path": str(self.target_a), "label": "A", "description": "文档资料"},
                    {"path": str(self.target_b), "label": "B", "description": "图片素材"},
                ],
            },
        )
        self.assertEqual(created.status_code, 200)
        profile_id = created.json()["item"]["profile_id"]

        listed = self.client.get("/api/target-profiles")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json()["items"]), 1)

        updated = self.client.patch(
            f"/api/target-profiles/{profile_id}",
            json={"name": "办公目录池-已更新"},
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["item"]["name"], "办公目录池-已更新")

        response = self.client.post(
            "/api/sessions",
            json={
                "sources": [{"source_type": "directory", "path": str(self.sources_dir)}],
                "resume_if_exists": False,
                "organize_method": "assign_into_existing_categories",
                "target_profile_id": profile_id,
                "strategy": {
                    "template_id": "general_downloads",
                    "task_type": "organize_into_existing",
                    "organize_method": "assign_into_existing_categories",
                },
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["session_snapshot"]["strategy"]["target_profile_id"], profile_id)
        self.assertEqual(
            response.json()["session_snapshot"]["strategy"]["target_directory_details"],
            [
                {"path": str(self.target_a), "label": "A", "description": "文档资料"},
                {"path": str(self.target_b), "label": "B", "description": "图片素材"},
            ],
        )

        deleted = self.client.delete(f"/api/target-profiles/{profile_id}")
        self.assertEqual(deleted.status_code, 200)

    def test_start_scan_supports_mixed_source_collection(self):
        source_dir = self.sources_dir / "dir-source"
        source_dir.mkdir(parents=True, exist_ok=True)
        (source_dir / "inside.txt").write_text("inside", encoding="utf-8")
        single_file = self.sources_dir / "lonely.txt"
        single_file.write_text("hello", encoding="utf-8")

        created = self.service.create_session(
            [
                {"source_type": "directory", "path": str(source_dir)},
                {"source_type": "file", "path": str(single_file)},
            ],
            resume_if_exists=False,
            organize_method="categorize_into_new_structure",
            strategy={"template_id": "general_downloads"},
            output_dir=str(self.output_dir),
        )
        session = created.session
        assert session is not None

        def analyze_context(_target_dir: Path, entry_context: dict, **_kwargs):
            lines = []
            for item in entry_context.values():
                if item["entry_name"] == "dir-source/inside.txt":
                    lines.append("dir-source/inside.txt | file | 资料 | 目录中的文件")
                elif item["entry_name"] == "lonely.txt":
                    lines.append("lonely.txt | file | 资料 | 单文件来源")
            return "\n".join(lines)

        with mock.patch(
            "file_pilot.app.session_service.analysis_service.run_analysis_cycle_for_entry_context",
            side_effect=analyze_context,
        ):
            scanned = self.service.start_scan(session.session_id, scan_runner=lambda _path: "")

        self.assertEqual(scanned.stage, "planning")
        snapshot = self.service.get_snapshot(session.session_id)
        item_relpaths = {item["source_relpath"] for item in snapshot.get("source_tree_entries", [])}
        self.assertIn("dir-source/inside.txt", item_relpaths)
        self.assertIn("lonely.txt", item_relpaths)

    def test_scan_source_collection_keeps_multiple_file_sources_flat_paths(self):
        first_file = self.sources_dir / "future_architecture.md"
        second_file = self.sources_dir / "分析.png"
        first_file.write_text("hello", encoding="utf-8")
        second_file.write_text("hello", encoding="utf-8")

        created = self.service.create_session(
            [
                {"source_type": "file", "path": str(first_file)},
                {"source_type": "file", "path": str(second_file)},
            ],
            resume_if_exists=False,
            organize_method="categorize_into_new_structure",
            strategy={"template_id": "general_downloads"},
            output_dir=str(self.output_dir),
        )
        session = created.session
        assert session is not None

        def analyze_context(_target_dir: Path, entry_context: dict, **_kwargs):
            lines = []
            for item in entry_context.values():
                name = item["entry_name"]
                if name.endswith(".md"):
                    lines.append(f"{name} | file | 技术文档 | 架构说明")
                else:
                    lines.append(f"{name} | file | 图片/截图 | 分析截图")
            return "\n".join(lines)

        with mock.patch(
            "file_pilot.app.session_service.analysis_service.run_analysis_cycle_for_entry_context",
            side_effect=analyze_context,
        ) as analyze_entries:
            scan_lines, entries = self.service._scan_source_collection(session, scan_runner=lambda _path: "")

        analyze_entries.assert_called_once()
        self.assertEqual({entry["source_relpath"] for entry in entries}, {"future_architecture.md", "分析.png"})
        self.assertNotIn("future_architecture.md/future_architecture.md", scan_lines)
        self.assertNotIn("分析.png/分析.png", scan_lines)

        session.scan_lines = scan_lines
        self.service._ensure_planner_items(session, scan_lines)
        tree_relpaths = {item["source_relpath"] for item in session.source_tree_entries}
        self.assertEqual(tree_relpaths, {"future_architecture.md", "分析.png"})
        inspection_by_name = {
            item["display_name"]: item
            for item in session.inspection_context.values()
        }
        self.assertEqual(
            set(inspection_by_name),
            {"future_architecture.md", "分析.png"},
        )
        self.assertTrue(inspection_by_name["future_architecture.md"]["absolute_path"].endswith("future_architecture.md"))
        self.assertTrue(inspection_by_name["分析.png"]["allowed_base_dir"].endswith(str(self.sources_dir.name)))

    def test_create_session_uses_parent_workspace_for_atomic_directory_source(self):
        atomic_dir = self.sources_dir / "ProjectBundle"
        atomic_dir.mkdir(parents=True, exist_ok=True)
        (atomic_dir / "README.md").write_text("bundle", encoding="utf-8")

        created = self.service.create_session(
            [{"source_type": "directory", "path": str(atomic_dir), "directory_mode": "atomic"}],
            resume_if_exists=False,
            organize_method="assign_into_existing_categories",
            strategy={
                "template_id": "general_downloads",
                "organize_method": "assign_into_existing_categories",
                "organize_mode": "incremental",
            },
            target_directories=[str(self.target_a)],
        )
        session = created.session
        assert session is not None

        self.assertEqual(Path(session.target_dir).resolve(), atomic_dir.parent.resolve())
        self.assertEqual(session.placement.new_directory_root, str(atomic_dir.parent.resolve()))
        self.assertEqual(session.placement.review_root, str((atomic_dir.parent / "Review").resolve()))

    def test_scan_source_collection_treats_atomic_directory_as_single_entry(self):
        atomic_dir = self.sources_dir / "project.v1"
        atomic_dir.mkdir(parents=True, exist_ok=True)
        (atomic_dir / "notes.txt").write_text("bundle", encoding="utf-8")

        created = self.service.create_session(
            [{"source_type": "directory", "path": str(atomic_dir), "directory_mode": "atomic"}],
            resume_if_exists=False,
            organize_method="categorize_into_new_structure",
            strategy={"template_id": "general_downloads"},
            output_dir=str(self.output_dir),
        )
        session = created.session
        assert session is not None

        def fail_directory_scan(_path: Path, session_id: str | None = None):
            del _path, session_id
            raise AssertionError("atomic directory source should not use directory scan")

        with mock.patch(
            "file_pilot.app.session_service.analysis_service.run_analysis_cycle_for_entry_context",
            return_value="project.v1 | dir | 项目目录 | 整体项目目录",
        ) as analyze_entries:
            scan_lines, entries = self.service._scan_source_collection(session, scan_runner=fail_directory_scan)

        analyze_entries.assert_called_once()
        args, kwargs = analyze_entries.call_args
        self.assertEqual(args[0], self.output_dir.resolve())
        self.assertEqual(list(args[1].keys()), ["F001"])
        self.assertEqual(args[1]["F001"]["absolute_path"], str(atomic_dir.resolve()))
        self.assertEqual(kwargs["session_id"], None)
        self.assertEqual(scan_lines, "project.v1 | dir | 项目目录 | 整体项目目录")
        self.assertEqual(entries[0]["source_relpath"], "project.v1")
        self.assertEqual(entries[0]["entry_type"], "dir")

    def test_execute_moves_atomic_directory_source_as_single_item(self):
        atomic_dir = self.sources_dir / "ProjectBundle"
        atomic_dir.mkdir(parents=True, exist_ok=True)
        (atomic_dir / "README.md").write_text("bundle", encoding="utf-8")

        created = self.service.create_session(
            [{"source_type": "directory", "path": str(atomic_dir), "directory_mode": "atomic"}],
            resume_if_exists=False,
            organize_method="categorize_into_new_structure",
            strategy={
                "template_id": "general_downloads",
                "organize_method": "categorize_into_new_structure",
            },
            output_dir=str(self.output_dir),
        )
        session = created.session
        assert session is not None
        session.stage = "planning"
        session.scan_lines = "ProjectBundle | dir | 项目目录 | 需要整体移动"
        session.pending_plan = {
            "directories": ["Projects"],
            "moves": [{"source": "ProjectBundle", "target": "Projects/ProjectBundle"}],
            "unresolved_items": [],
            "summary": "已规划 1 项",
        }
        self.store.save(session)

        precheck = self.service.run_precheck(session.session_id)
        preview = precheck.session_snapshot["precheck_summary"]["move_preview"][0]
        self.assertTrue(precheck.session_snapshot["precheck_summary"]["can_execute"])
        self.assertTrue(preview["source"].endswith("/ProjectBundle"))
        self.assertEqual(preview["target"], "Projects/ProjectBundle")

        execution = self.service.execute(session.session_id, confirm=True)
        self.assertEqual(execution.session_snapshot["stage"], "completed")
        self.assertFalse(atomic_dir.exists())
        self.assertTrue((self.output_dir / "Projects" / "ProjectBundle").is_dir())
        self.assertTrue((self.output_dir / "Projects" / "ProjectBundle" / "README.md").exists())
