import shutil
import time
import unittest
from pathlib import Path

from file_pilot.app.session_service import OrganizerSessionService
from file_pilot.app.session_store import SessionStore
from file_pilot.organize.models import PendingPlan


class TargetResolverTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_target_resolver")
        if self.root.exists():
            shutil.rmtree(self.root, ignore_errors=True)
        self.target_dir = (self.root / "Inbox").resolve()
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

    def test_placement_payload_defaults_review_root(self):
        placement = self.service.target_resolver.placement_payload(
            {"new_directory_root": str(self.target_dir)}
        )

        self.assertEqual(placement.new_directory_root, str(self.target_dir))
        self.assertEqual(placement.review_root, str((self.target_dir / "Review").resolve()))

    def test_resolve_target_real_path_uses_new_directory_root(self):
        result = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            new_directory_root=str((self.root / "Sorted").resolve()),
            review_root=str((self.root / "ManualReview").resolve()),
        )
        session = result.session
        assert session is not None

        resolved = self.service.target_resolver.resolve_target_real_path(session, "Docs/Notes")
        review_path = self.service.target_resolver.review_target_path(session, "drafts/note.md")

        self.assertEqual(resolved, (self.root / "Sorted" / "Docs" / "Notes").resolve())
        self.assertEqual(review_path, (self.root / "ManualReview" / "note.md").resolve())

    def test_create_session_allows_default_review_root_under_new_root(self):
        result = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            new_directory_root=str((self.root / "Sorted").resolve()),
        )

        session = result.session
        assert session is not None
        self.assertEqual(session.placement.review_root, str((self.root / "Sorted" / "Review").resolve()))

    def test_create_session_rejects_review_root_conflicts_with_new_root(self):
        sorted_root = (self.root / "Sorted").resolve()
        cases = [
            sorted_root,
            self.root.resolve(),
            sorted_root / "NestedReview",
        ]

        for review_root in cases:
            with self.subTest(review_root=review_root):
                with self.assertRaisesRegex(ValueError, "REVIEW_ROOT_CONFLICT"):
                    self.service.create_session(
                        str(self.target_dir),
                        resume_if_exists=False,
                        new_directory_root=str(sorted_root),
                        review_root=str(review_root),
                    )

    def test_create_session_rejects_review_root_conflicts_with_target_directories(self):
        sorted_root = (self.root / "Sorted").resolve()
        archive_root = (self.root / "Archive").resolve()
        review_root = (archive_root / "Review").resolve()
        archive_root.mkdir(parents=True, exist_ok=True)

        for target_directory in [review_root, archive_root, review_root / "Accepted"]:
            with self.subTest(target_directory=target_directory):
                with self.assertRaisesRegex(ValueError, "REVIEW_ROOT_CONFLICT"):
                    self.service.create_session(
                        str(self.target_dir),
                        resume_if_exists=False,
                        organize_method="assign_into_existing_categories",
                        strategy={"organize_mode": "incremental"},
                        new_directory_root=str(sorted_root),
                        review_root=str(review_root),
                        target_directories=[str(target_directory)],
                    )

    def test_normalized_target_rejects_absolute_target_dir_and_review_subdirectory(self):
        result = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = result.session
        assert session is not None

        with self.assertRaisesRegex(RuntimeError, "ABSOLUTE_TARGET_DIR_NOT_ALLOWED"):
            self.service.target_resolver.normalized_target(
                session,
                PendingPlan(),
                target_dir=str((self.root / "Outside").resolve()),
            )

        with self.assertRaisesRegex(RuntimeError, "REVIEW_SUBDIRECTORY_NOT_ALLOWED"):
            self.service.target_resolver.normalized_target(
                session,
                PendingPlan(),
                target_dir="Review/NeedCheck",
            )

    def test_normalized_target_rejects_paths_that_escape_new_root(self):
        result = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = result.session
        assert session is not None

        for target_dir in ["../Outside", "Docs/../../Outside", "C:Outside"]:
            with self.subTest(target_dir=target_dir):
                with self.assertRaisesRegex(RuntimeError, "TARGET_DIR_OUTSIDE_ROOT|ABSOLUTE_TARGET_DIR_NOT_ALLOWED"):
                    self.service.target_resolver.normalized_target(
                        session,
                        PendingPlan(),
                        target_dir=target_dir,
                    )

    def test_incremental_target_validation_rejects_unknown_paths(self):
        selection = {
            "root_directory_options": ["Docs", "Archive"],
            "target_directories": ["Docs"],
        }

        resolver = self.service.target_resolver
        session = self.service.create_session(str(self.target_dir), resume_if_exists=False).session
        assert session is not None

        self.assertTrue(resolver.validate_incremental_target_dir(session, "Review", selection))
        self.assertFalse(resolver.validate_incremental_target_dir(session, "Docs/Notes", selection))
        self.assertFalse(resolver.validate_incremental_target_dir(session, "Archive/Old", selection))
        self.assertFalse(resolver.validate_incremental_target_dir(session, "NewFolder", selection))

    def test_target_dir_from_slot_id_falls_back_to_absolute_real_path(self):
        docs_dir = (self.target_dir / "Docs").resolve()
        archive_dir = (self.root / "Archive").resolve()
        docs_dir.mkdir(parents=True, exist_ok=True)
        archive_dir.mkdir(parents=True, exist_ok=True)

        result = self.service.create_session(
            str(self.target_dir),
            resume_if_exists=False,
            organize_method="assign_into_existing_categories",
            strategy={"organize_mode": "incremental", "destination_index_depth": 1},
            target_directories=[str(docs_dir), str(archive_dir)],
        )
        session = result.session
        assert session is not None
        session.stage = "planning"
        session.scan_lines = "md | file | 学习资料 | 笔记"
        session.incremental_selection = {
            "required": True,
            "status": "ready",
            "destination_index_depth": 1,
            "root_directory_options": [str(docs_dir), str(archive_dir)],
            "target_directories": [str(docs_dir), str(archive_dir)],
            "target_directory_tree": [
                {"relpath": str(docs_dir), "name": "Docs", "children": []},
                {"relpath": str(archive_dir), "name": "Archive", "children": []},
            ],
            "pending_items_count": 1,
            "source_scan_completed": True,
        }

        resolved = self.service.target_resolver.target_dir_from_slot_id(session, "D002", PendingPlan())

        self.assertEqual(Path(resolved), archive_dir)
