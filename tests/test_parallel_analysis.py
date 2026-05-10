import json
import shutil
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from file_pilot.analysis import service as analysis_service
from file_pilot.analysis.models import AnalysisItem


class ParallelAnalysisTests(unittest.TestCase):
    def setUp(self):
        self.base_dir = Path("test_temp_parallel_analysis")
        if self.base_dir.exists():
            shutil.rmtree(self.base_dir)
        self.base_dir.mkdir()

    def tearDown(self):
        if self.base_dir.exists():
            shutil.rmtree(self.base_dir)
        outside_dir = Path("test_temp_parallel_analysis_outside")
        if outside_dir.exists():
            shutil.rmtree(outside_dir)

    def _make_entries(self, count: int) -> list[str]:
        entries = []
        for index in range(count):
            name = f"file_{index:03d}.txt"
            (self.base_dir / name).write_text(f"demo {index}", encoding="utf-8")
            entries.append(name)
        return sorted(entries)

    def test_split_batches_balances_large_directory(self):
        cases = {
            31: [31],
            45: [45],
            60: [60],
            100: [100],
            201: [67, 67, 67],
        }
        for total, expected_sizes in cases.items():
            with self.subTest(total=total):
                entries = [f"item_{index:03d}" for index in range(total)]
                batches = analysis_service._split_batches(entries)
                self.assertEqual([len(batch) for batch in batches], expected_sizes)
                self.assertEqual([item for batch in batches for item in batch], entries)

    def test_slice_files_info_for_batch_keeps_only_batch_visible_entries(self):
        (self.base_dir / "alpha.txt").write_text("alpha", encoding="utf-8")
        (self.base_dir / "keepdir").mkdir()
        (self.base_dir / "keepdir" / "child.txt").write_text("child", encoding="utf-8")
        (self.base_dir / "skipdir").mkdir()
        (self.base_dir / "skipdir" / "ignored.txt").write_text("ignored", encoding="utf-8")

        files_info = analysis_service.list_local_files(str(self.base_dir), max_depth=1, char_limit=0)
        sliced = analysis_service._slice_files_info_for_batch(files_info, ["alpha.txt", "keepdir"], self.base_dir)

        self.assertIn("包含 2 个条目", sliced)
        self.assertIn("alpha.txt", sliced)
        self.assertIn("keepdir", sliced)
        self.assertIn("keepdir/child.txt", sliced)
        self.assertNotIn("skipdir", sliced)
        self.assertNotIn("ignored.txt", sliced)

    def test_analyze_batch_returns_correct_items(self):
        (self.base_dir / "alpha.txt").write_text("alpha", encoding="utf-8")
        (self.base_dir / "keepdir").mkdir()
        files_info = analysis_service.list_local_files(str(self.base_dir), max_depth=1, char_limit=0)
        tool_call = SimpleNamespace(
            function=SimpleNamespace(
                name=analysis_service.SUBMIT_ANALYSIS_TOOL_NAME,
                arguments=json.dumps(
                    {
                        "items": [
                            {"entry_id": "F001", "entry_type": "file", "suggested_purpose": "文档", "summary": "alpha"},
                            {"entry_id": "F002", "entry_type": "dir", "suggested_purpose": "目录", "summary": "keepdir"},
                        ]
                    },
                    ensure_ascii=False,
                ),
            )
        )
        response = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(tool_calls=[tool_call], content=""))]
        )
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=mock.Mock(return_value=response))))

        with mock.patch.object(analysis_service, "get_client", return_value=client):
            items = analysis_service._analyze_batch(
                self.base_dir,
                ["alpha.txt", "keepdir"],
                0,
                2,
                files_info,
                analysis_service.ANALYSIS_MODEL_NAME,
            )

        self.assertEqual([item.entry_name for item in items], ["alpha.txt", "keepdir"])
        self.assertEqual(items[0].summary, "alpha")

    def test_context_batch_read_rejects_unknown_and_out_of_scope_entry_ids(self):
        inside_file = self.base_dir / "inside.txt"
        inside_file.write_text("inside", encoding="utf-8")
        outside_dir = Path("test_temp_parallel_analysis_outside")
        outside_dir.mkdir()
        (outside_dir / "secret.txt").write_text("secret", encoding="utf-8")
        entry_context = {
            "F001": {
                "entry_id": "F001",
                "entry_name": "inside.txt",
                "display_name": "inside.txt",
                "entry_type": "file",
                "absolute_path": str(inside_file.resolve()),
                "source_relpath": "inside.txt",
                "origin_path": str(self.base_dir.resolve()),
                "origin_relpath": "inside.txt",
                "allowed_base_dir": str(self.base_dir.resolve()),
            },
            "F002": {
                "entry_id": "F002",
                "entry_name": "outside",
                "display_name": "outside",
                "entry_type": "dir",
                "absolute_path": str(outside_dir.resolve()),
                "source_relpath": "outside",
                "origin_path": str(outside_dir.resolve()),
                "origin_relpath": "outside",
                "allowed_base_dir": str(self.base_dir.resolve()),
            },
        }

        result = analysis_service._dispatch_tool_call(
            self.base_dir,
            analysis_service.BATCH_READ_TOOL_NAME,
            {"entry_ids": ["F001", "F002", "F999"]},
            entry_context=entry_context,
        )

        self.assertIn("inside", result)
        self.assertIn("条目路径超出授权范围", result)
        self.assertIn("未找到对应条目", result)
        self.assertNotIn("secret", result)

    def test_run_analysis_cycle_uses_single_path_for_small_directory(self):
        self._make_entries(30)

        with mock.patch.object(analysis_service, "_run_single_analysis", return_value="serial-result") as single_mock, mock.patch.object(
            analysis_service, "_analyze_batch"
        ) as batch_mock, mock.patch.object(analysis_service, "list_local_files", return_value="files-info"):
            result = analysis_service.run_analysis_cycle(self.base_dir)

        self.assertEqual(result, "serial-result")
        single_mock.assert_called_once()
        batch_mock.assert_not_called()

    def test_run_analysis_cycle_reads_runtime_model_when_not_explicitly_passed(self):
        self._make_entries(2)

        with mock.patch.object(analysis_service, "get_analysis_model_name", return_value="glm-4.7"), mock.patch.object(
            analysis_service,
            "_run_single_analysis",
            return_value="serial-result",
        ) as single_mock, mock.patch.object(analysis_service, "list_local_files", return_value="files-info"):
            result = analysis_service.run_analysis_cycle(self.base_dir)

        self.assertEqual(result, "serial-result")
        self.assertEqual(single_mock.call_args.args[2], "glm-4.7")

    def test_failed_batch_triggers_retry_and_merges_complete_result(self):
        entries = self._make_entries(31)

        def fake_analyze_batch(_target_dir, batch_entries, batch_index, _total_batches, _files_info, _model, session_id=None, event_handler=None):
            del session_id, event_handler
            if batch_index == 0:
                raise RuntimeError("first batch failed")
            return [
                AnalysisItem(entry_name=name, suggested_purpose="文档", summary=f"{name} summary")
                for name in batch_entries
            ]

        events: list[tuple[str, dict]] = []
        with mock.patch.object(analysis_service, "_analyze_batch", side_effect=fake_analyze_batch), mock.patch.object(
            analysis_service,
            "list_local_files",
            side_effect=["root-info", "detailed-info"],
        ):
            rendered = analysis_service.run_analysis_cycle(
                self.base_dir,
                event_handler=lambda event_type, data=None: events.append((event_type, data or {})),
            )

        self.assertIsNotNone(rendered)
        for name in entries:
            self.assertIn(name, rendered)
        self.assertIn(("batch_split", {"total_entries": 31, "batch_count": 1, "worker_count": 1}), events)
        progress_events = [event for event in events if event[0] == "batch_progress"]
        self.assertEqual(len(progress_events), 3)
        self.assertTrue(any(payload.get("status") == "failed" for _, payload in progress_events))
        self.assertTrue(any(payload.get("status") == "retrying" for _, payload in progress_events))
        for _, payload in progress_events:
            if payload.get("status") == "failed":
                self.assertLess(payload.get("completed_batches", 0), payload.get("total_batches", 0))

    def test_run_analysis_cycle_emits_dynamic_worker_count_for_larger_directory(self):
        entries = self._make_entries(60)

        def fake_analyze_batch(_target_dir, batch_entries, batch_index, _total_batches, _files_info, _model, session_id=None, event_handler=None):
            del session_id, event_handler
            return [
                AnalysisItem(entry_name=name, suggested_purpose="文档", summary=f"{name} summary")
                for name in batch_entries
            ]

        events: list[tuple[str, dict]] = []
        with mock.patch.object(analysis_service, "_analyze_batch", side_effect=fake_analyze_batch), mock.patch.object(
            analysis_service,
            "list_local_files",
            side_effect=["root-info", "detailed-info"],
        ):
            rendered = analysis_service.run_analysis_cycle(
                self.base_dir,
                event_handler=lambda event_type, data=None: events.append((event_type, data or {})),
            )

        self.assertIsNotNone(rendered)
        for name in entries:
            self.assertIn(name, rendered)
        self.assertIn(("batch_split", {"total_entries": 60, "batch_count": 1, "worker_count": 1}), events)
        progress_events = [event for event in events if event[0] == "batch_progress"]
        self.assertEqual(len(progress_events), 1)

    def test_missing_entries_get_placeholder_when_retry_also_fails(self):
        entries = self._make_entries(31)

        def fake_analyze_batch(_target_dir, batch_entries, batch_index, _total_batches, _files_info, _model, event_handler=None):
            del event_handler
            if batch_index in {0, 3}:
                raise RuntimeError("batch failed")
            return [
                AnalysisItem(entry_name=name, suggested_purpose="文档", summary=f"{name} summary")
                for name in batch_entries
            ]

        with mock.patch.object(analysis_service, "_analyze_batch", side_effect=fake_analyze_batch), mock.patch.object(
            analysis_service,
            "list_local_files",
            side_effect=["root-info", "detailed-info"],
        ):
            rendered = analysis_service.run_analysis_cycle(self.base_dir)

        missing_batch = set(analysis_service._split_batches(entries)[0])
        self.assertIsNotNone(rendered)
        for name in missing_batch:
            self.assertIn(f"{name} |  | 待判断 | 分析未覆盖，需手动确认", rendered)


if __name__ == "__main__":
    unittest.main()
