import json
import shutil
import unittest
from pathlib import Path
from unittest import mock

from file_pilot.execution import service as execution_service
from file_pilot.execution.models import MappedExecutionAction, MappedExecutionPlan
from file_pilot.organize import service as organizer_service


class ExecutionServiceTests(unittest.TestCase):
    def setUp(self):
        self.base_dir = Path("test_temp_execution_service")
        self.history_root = Path("test_temp_execution_history")
        if self.base_dir.exists():
            shutil.rmtree(self.base_dir)
        if self.history_root.exists():
            shutil.rmtree(self.history_root)
        self.base_dir.mkdir()
        self.history_root.mkdir()

    def tearDown(self):
        if self.base_dir.exists():
            shutil.rmtree(self.base_dir)
        if self.history_root.exists():
            shutil.rmtree(self.history_root)

    def test_build_execution_plan_uses_absolute_paths(self):
        parsed = organizer_service.parse_commands_block(
            '<COMMANDS>\nMKDIR "Projects"\nMOVE "demo.txt" "Projects/demo.txt"\n</COMMANDS>'
        )

        plan = execution_service.build_execution_plan(parsed, self.base_dir)

        self.assertEqual(plan.base_dir, self.base_dir.resolve())
        self.assertEqual(plan.mkdir_actions[0].target, self.base_dir.resolve() / "Projects")
        self.assertEqual(plan.move_actions[0].source, self.base_dir.resolve() / "demo.txt")
        self.assertEqual(plan.move_actions[0].target, self.base_dir.resolve() / "Projects" / "demo.txt")

    def test_build_execution_plan_from_mapped_preserves_id_metadata(self):
        mapped_plan = MappedExecutionPlan(
            base_dir=self.base_dir.resolve(),
            mkdir_actions=[
                MappedExecutionAction(
                    type="MKDIR",
                    target_path=self.base_dir.resolve() / "Projects",
                    target_slot_id="D001",
                    display_name="Projects",
                )
            ],
            move_actions=[
                MappedExecutionAction(
                    type="MOVE",
                    source_path=self.base_dir.resolve() / "demo.txt",
                    target_path=self.base_dir.resolve() / "Projects" / "demo.txt",
                    item_id="F001",
                    source_ref_id="F001",
                    target_slot_id="D001",
                    display_name="demo.txt",
                )
            ],
        )

        plan = execution_service.build_execution_plan_from_mapped(mapped_plan)

        self.assertEqual(plan.mkdir_actions[0].target_slot_id, "D001")
        self.assertEqual(plan.move_actions[0].item_id, "F001")
        self.assertEqual(plan.move_actions[0].source_ref_id, "F001")
        self.assertEqual(plan.move_actions[0].display_name, "demo.txt")

    def test_validate_execution_preconditions_skips_existing_target_per_item(self):
        (self.base_dir / "demo.txt").write_text("demo", encoding="utf-8")
        (self.base_dir / "ok.txt").write_text("ok", encoding="utf-8")
        (self.base_dir / "Projects").mkdir()
        (self.base_dir / "Projects" / "demo.txt").write_text("exists", encoding="utf-8")
        parsed = organizer_service.parse_commands_block(
            '<COMMANDS>\n'
            'MKDIR "Projects"\n'
            'MOVE "demo.txt" "Projects/demo.txt"\n'
            'MOVE "ok.txt" "Projects/ok.txt"\n'
            '</COMMANDS>'
        )
        plan = execution_service.build_execution_plan(parsed, self.base_dir)

        precheck = execution_service.validate_execution_preconditions(plan)

        # 单项冲突不再阻断整批：其余可执行项仍放行
        self.assertTrue(precheck.can_execute)
        self.assertEqual(precheck.blocking_errors, [])
        self.assertEqual(len(precheck.item_skips), 1)
        skip = precheck.item_skips[0]
        self.assertEqual(skip.reason, "target_exists")
        self.assertIn("Projects/demo.txt", skip.message)

    def test_validate_execution_preconditions_blocks_when_no_item_executable(self):
        (self.base_dir / "demo.txt").write_text("demo", encoding="utf-8")
        (self.base_dir / "Projects").mkdir()
        (self.base_dir / "Projects" / "demo.txt").write_text("exists", encoding="utf-8")
        parsed = organizer_service.parse_commands_block(
            '<COMMANDS>\nMKDIR "Projects"\nMOVE "demo.txt" "Projects/demo.txt"\n</COMMANDS>'
        )
        plan = execution_service.build_execution_plan(parsed, self.base_dir)

        precheck = execution_service.validate_execution_preconditions(plan)

        # 所有移动都被跳过时没有执行的意义
        self.assertFalse(precheck.can_execute)
        self.assertEqual(len(precheck.item_skips), 1)

    def test_validate_execution_preconditions_skips_duplicate_targets_keeping_first(self):
        (self.base_dir / "alpha").mkdir()
        (self.base_dir / "beta").mkdir()
        (self.base_dir / "alpha" / "report.pdf").write_text("alpha", encoding="utf-8")
        (self.base_dir / "beta" / "report.pdf").write_text("beta", encoding="utf-8")
        parsed = organizer_service.parse_commands_block(
            '<COMMANDS>\n'
            'MKDIR "Docs"\n'
            'MOVE "alpha/report.pdf" "Docs/report.pdf"\n'
            'MOVE "beta/report.pdf" "Docs/report.pdf"\n'
            '</COMMANDS>'
        )
        plan = execution_service.build_execution_plan(parsed, self.base_dir)

        precheck = execution_service.validate_execution_preconditions(plan)

        # 按执行顺序保留第一个，其余跳过；不再整批阻断
        self.assertTrue(precheck.can_execute)
        duplicate_skips = [skip for skip in precheck.item_skips if skip.reason == "duplicate_target"]
        self.assertEqual(len(duplicate_skips), 1)
        self.assertIn("Docs/report.pdf", duplicate_skips[0].message)

    def test_execute_plan_skips_move_when_target_appears_after_precheck(self):
        (self.base_dir / "demo.txt").write_text("demo", encoding="utf-8")
        (self.base_dir / "ok.txt").write_text("ok", encoding="utf-8")
        parsed = organizer_service.parse_commands_block(
            '<COMMANDS>\n'
            'MKDIR "Projects"\n'
            'MOVE "demo.txt" "Projects/demo.txt"\n'
            'MOVE "ok.txt" "Projects/ok.txt"\n'
            '</COMMANDS>'
        )
        plan = execution_service.build_execution_plan(parsed, self.base_dir)
        # 预检之后、执行之前目标才出现（模拟 TOCTOU）
        (self.base_dir / "Projects").mkdir()
        (self.base_dir / "Projects" / "demo.txt").write_text("occupied", encoding="utf-8")

        report = execution_service.execute_plan(plan)

        # 冲突项跳过且原文件原样留在原地，绝不覆盖
        self.assertEqual(report.skipped_count, 1)
        self.assertEqual(report.failure_count, 0)
        self.assertTrue((self.base_dir / "demo.txt").exists())
        self.assertEqual(
            (self.base_dir / "Projects" / "demo.txt").read_text(encoding="utf-8"),
            "occupied",
        )
        self.assertTrue((self.base_dir / "Projects" / "ok.txt").exists())
        skipped = [item for item in report.results if item.status == "skipped"]
        self.assertEqual(len(skipped), 1)

    def test_execute_plan_records_skipped_status_in_journal(self):
        (self.base_dir / "demo.txt").write_text("demo", encoding="utf-8")
        parsed = organizer_service.parse_commands_block(
            '<COMMANDS>\nMKDIR "Projects"\nMOVE "demo.txt" "Projects/demo.txt"\n</COMMANDS>'
        )
        plan = execution_service.build_execution_plan(parsed, self.base_dir)
        (self.base_dir / "Projects").mkdir()
        (self.base_dir / "Projects" / "demo.txt").write_text("occupied", encoding="utf-8")
        executions_dir = self.history_root / "executions"
        latest_path = self.history_root / "latest_by_directory.json"

        with mock.patch.object(execution_service.config, "EXECUTION_LOG_DIR", executions_dir), \
             mock.patch.object(execution_service.config, "LATEST_BY_DIRECTORY_PATH", latest_path):
            execution_service.execute_plan(plan)

        journal_files = list(executions_dir.glob("*.json"))
        journal = json.loads(journal_files[0].read_text(encoding="utf-8"))
        move_item = journal["items"][1]
        self.assertEqual(move_item["status"], "skipped")
        self.assertIn("同名", move_item["message"])
        self.assertEqual(journal["status"], "completed")

    def test_validate_execution_preconditions_warns_cross_volume_move(self):
        (self.base_dir / "demo.txt").write_text("demo", encoding="utf-8")
        (self.base_dir / "Projects").mkdir()
        parsed = organizer_service.parse_commands_block(
            '<COMMANDS>\nMKDIR "Projects"\nMOVE "demo.txt" "Projects/demo.txt"\n</COMMANDS>'
        )
        plan = execution_service.build_execution_plan(parsed, self.base_dir)

        with mock.patch.object(execution_service, "_is_cross_volume_move", return_value=True):
            precheck = execution_service.validate_execution_preconditions(plan)

        self.assertTrue(precheck.can_execute)
        self.assertTrue(any("可能跨磁盘分区移动" in warning for warning in precheck.warnings))

    def test_render_execution_preview_lists_summary_and_targets(self):
        (self.base_dir / "demo.txt").write_text("demo", encoding="utf-8")
        parsed = organizer_service.parse_commands_block(
            '<COMMANDS>\nMKDIR "Projects"\nMOVE "demo.txt" "Projects/demo.txt"\n</COMMANDS>'
        )
        plan = execution_service.build_execution_plan(parsed, self.base_dir)
        precheck = execution_service.validate_execution_preconditions(plan)

        preview = execution_service.render_execution_preview(plan, precheck)

        self.assertIn("创建目录", preview)
        self.assertIn("移动项目", preview)
        self.assertIn("Projects/demo.txt", preview)

    def test_render_execution_preview_shows_display_name_when_present(self):
        plan = execution_service.build_execution_plan_from_mapped(
            MappedExecutionPlan(
                base_dir=self.base_dir.resolve(),
                move_actions=[
                    MappedExecutionAction(
                        type="MOVE",
                        source_path=self.base_dir.resolve() / "demo.txt",
                        target_path=self.base_dir.resolve() / "Projects" / "demo.txt",
                        item_id="F001",
                        display_name="demo.txt",
                    )
                ],
            )
        )
        precheck = execution_service.PrecheckResult(can_execute=True)

        preview = execution_service.render_execution_preview(plan, precheck)

        self.assertIn("[demo.txt]", preview)

    def test_execute_plan_moves_directory_tree(self):
        source_dir = self.base_dir / "demo-folder"
        source_dir.mkdir()
        (source_dir / "nested.txt").write_text("nested", encoding="utf-8")
        parsed = organizer_service.parse_commands_block(
            '<COMMANDS>\nMKDIR "Projects"\nMOVE "demo-folder" "Projects/demo-folder"\n</COMMANDS>'
        )
        plan = execution_service.build_execution_plan(parsed, self.base_dir)

        report = execution_service.execute_plan(plan)

        self.assertEqual(report.failure_count, 0)
        self.assertFalse(source_dir.exists())
        self.assertTrue((self.base_dir / "Projects" / "demo-folder" / "nested.txt").exists())

    def test_build_execution_plan_orders_nested_sources_deepest_first(self):
        parsed = organizer_service.parse_commands_block(
            '<COMMANDS>\n'
            'MKDIR "Archive"\n'
            'MKDIR "Docs"\n'
            'MOVE "workspace" "Archive/workspace"\n'
            'MOVE "workspace/report.pdf" "Docs/report.pdf"\n'
            '</COMMANDS>'
        )

        plan = execution_service.build_execution_plan(parsed, self.base_dir)

        ordered = [action.source.name for action in plan.move_actions]
        self.assertEqual(ordered, ["report.pdf", "workspace"])

    def test_execute_plan_moves_nested_source_before_its_ancestor(self):
        workspace = self.base_dir / "workspace"
        workspace.mkdir()
        (workspace / "report.pdf").write_text("report", encoding="utf-8")
        (workspace / "keep.txt").write_text("keep", encoding="utf-8")
        parsed = organizer_service.parse_commands_block(
            '<COMMANDS>\n'
            'MKDIR "Archive"\n'
            'MKDIR "Docs"\n'
            'MOVE "workspace" "Archive/workspace"\n'
            'MOVE "workspace/report.pdf" "Docs/report.pdf"\n'
            '</COMMANDS>'
        )
        plan = execution_service.build_execution_plan(parsed, self.base_dir)

        report = execution_service.execute_plan(plan)

        self.assertEqual(report.failure_count, 0)
        self.assertTrue((self.base_dir / "Docs" / "report.pdf").exists())
        self.assertTrue((self.base_dir / "Archive" / "workspace" / "keep.txt").exists())
        self.assertFalse((self.base_dir / "Archive" / "workspace" / "report.pdf").exists())
        self.assertFalse(workspace.exists())

    def test_validate_execution_preconditions_warns_on_nested_sources(self):
        workspace = self.base_dir / "workspace"
        workspace.mkdir()
        (workspace / "report.pdf").write_text("report", encoding="utf-8")
        parsed = organizer_service.parse_commands_block(
            '<COMMANDS>\n'
            'MKDIR "Archive"\n'
            'MKDIR "Docs"\n'
            'MOVE "workspace" "Archive/workspace"\n'
            'MOVE "workspace/report.pdf" "Docs/report.pdf"\n'
            '</COMMANDS>'
        )
        plan = execution_service.build_execution_plan(parsed, self.base_dir)

        precheck = execution_service.validate_execution_preconditions(plan)

        self.assertTrue(precheck.can_execute)
        self.assertTrue(any("位于同批移动的" in item for item in precheck.warnings))

    def test_validate_execution_preconditions_ignores_unrelated_sources(self):
        (self.base_dir / "alpha.txt").write_text("alpha", encoding="utf-8")
        (self.base_dir / "beta.txt").write_text("beta", encoding="utf-8")
        parsed = organizer_service.parse_commands_block(
            '<COMMANDS>\n'
            'MKDIR "Docs"\n'
            'MOVE "alpha.txt" "Docs/alpha.txt"\n'
            'MOVE "beta.txt" "Docs/beta.txt"\n'
            '</COMMANDS>'
        )
        plan = execution_service.build_execution_plan(parsed, self.base_dir)

        precheck = execution_service.validate_execution_preconditions(plan)

        self.assertFalse(any("位于同批移动的" in item for item in precheck.warnings))

    def test_execute_plan_continues_after_single_move_failure(self):
        (self.base_dir / "broken.txt").write_text("broken", encoding="utf-8")
        (self.base_dir / "ok.txt").write_text("ok", encoding="utf-8")
        parsed = organizer_service.parse_commands_block(
            '<COMMANDS>\n'
            'MKDIR "Review"\n'
            'MOVE "broken.txt" "Review/broken.txt"\n'
            'MOVE "ok.txt" "Review/ok.txt"\n'
            '</COMMANDS>'
        )
        plan = execution_service.build_execution_plan(parsed, self.base_dir)

        original_move = shutil.move

        def flaky_move(src, dst):
            if Path(src).name == "broken.txt":
                raise OSError("mock move failure")
            return original_move(src, dst)

        with mock.patch("file_pilot.execution.service.shutil.move", side_effect=flaky_move):
            report = execution_service.execute_plan(plan)

        self.assertEqual(report.success_count, 2)
        self.assertEqual(report.failure_count, 1)
        self.assertTrue((self.base_dir / "Review" / "ok.txt").exists())
        self.assertTrue(any(item.status == "failed" for item in report.results))

    def test_execute_plan_persists_latest_execution_journal(self):
        (self.base_dir / "demo.txt").write_text("demo", encoding="utf-8")
        mapped_plan = MappedExecutionPlan(
            base_dir=self.base_dir.resolve(),
            mkdir_actions=[
                MappedExecutionAction(
                    type="MKDIR",
                    target_path=self.base_dir.resolve() / "Projects",
                    target_slot_id="D001",
                    display_name="Projects",
                )
            ],
            move_actions=[
                MappedExecutionAction(
                    type="MOVE",
                    source_path=self.base_dir.resolve() / "demo.txt",
                    target_path=self.base_dir.resolve() / "Projects" / "demo.txt",
                    item_id="F001",
                    source_ref_id="F001",
                    target_slot_id="D001",
                    display_name="demo.txt",
                )
            ],
        )
        plan = execution_service.build_execution_plan_from_mapped(mapped_plan)
        executions_dir = self.history_root / "executions"
        latest_path = self.history_root / "latest_by_directory.json"

        with mock.patch.object(execution_service.config, "EXECUTION_LOG_DIR", executions_dir), \
             mock.patch.object(execution_service.config, "LATEST_BY_DIRECTORY_PATH", latest_path):
            report = execution_service.execute_plan(plan)

        self.assertEqual(report.failure_count, 0)
        latest_index = json.loads(latest_path.read_text(encoding="utf-8"))
        execution_id = latest_index[str(self.base_dir.resolve())]
        journal_path = executions_dir / f"{execution_id}.json"
        journal = json.loads(journal_path.read_text(encoding="utf-8"))

        self.assertEqual(journal["status"], "completed")
        self.assertEqual(journal["target_dir"], str(self.base_dir.resolve()))
        self.assertEqual(len(journal["items"]), 2)
        self.assertEqual(journal["items"][1]["status"], "success")
        self.assertEqual(journal["items"][1]["item_id"], "F001")
        self.assertEqual(journal["items"][1]["source_ref_id"], "F001")
        self.assertEqual(journal["items"][1]["target_slot_id"], "D001")
        self.assertEqual(journal["items"][1]["display_name"], "demo.txt")

    def test_execute_plan_writes_ahead_before_and_after_every_action(self):
        (self.base_dir / "demo.txt").write_text("demo", encoding="utf-8")
        parsed = organizer_service.parse_commands_block(
            '<COMMANDS>\nMKDIR "Projects"\nMOVE "demo.txt" "Projects/demo.txt"\n</COMMANDS>'
        )
        plan = execution_service.build_execution_plan(parsed, self.base_dir)

        statuses_at_save: list[list[str]] = []

        def record_save(journal):
            statuses_at_save.append([item.status for item in journal.items])

        with mock.patch.object(execution_service, "save_execution_journal", side_effect=record_save), mock.patch.object(
            execution_service,
            "update_latest_execution_pointer",
        ):
            report = execution_service.execute_plan(plan)

        self.assertEqual(report.failure_count, 0)
        # 初始 1 次 + 每个动作意图/结果各 1 次 + 收尾 1 次
        self.assertEqual(len(statuses_at_save), 1 + 2 * 2 + 1)
        # 每个动作执行前，其意图必须已经以 pending 状态落盘
        self.assertEqual(statuses_at_save[1], ["pending"])
        self.assertEqual(statuses_at_save[2], ["success"])
        self.assertEqual(statuses_at_save[3], ["success", "pending"])
        self.assertEqual(statuses_at_save[4], ["success", "success"])

    def test_execute_plan_crash_leaves_pending_intent_in_journal(self):
        (self.base_dir / "first.txt").write_text("first", encoding="utf-8")
        (self.base_dir / "second.txt").write_text("second", encoding="utf-8")
        parsed = organizer_service.parse_commands_block(
            '<COMMANDS>\n'
            'MKDIR "Docs"\n'
            'MOVE "first.txt" "Docs/first.txt"\n'
            'MOVE "second.txt" "Docs/second.txt"\n'
            '</COMMANDS>'
        )
        plan = execution_service.build_execution_plan(parsed, self.base_dir)
        executions_dir = self.history_root / "executions"
        latest_path = self.history_root / "latest_by_directory.json"

        original_move = shutil.move

        def crashing_move(src, dst):
            if Path(src).name == "second.txt":
                raise KeyboardInterrupt("simulated crash")
            return original_move(src, dst)

        with mock.patch.object(execution_service.config, "EXECUTION_LOG_DIR", executions_dir), \
             mock.patch.object(execution_service.config, "LATEST_BY_DIRECTORY_PATH", latest_path), \
             mock.patch("file_pilot.execution.service.shutil.move", side_effect=crashing_move):
            with self.assertRaises(KeyboardInterrupt):
                execution_service.execute_plan(plan)

        journal_files = list(executions_dir.glob("*.json"))
        self.assertEqual(len(journal_files), 1)
        journal = json.loads(journal_files[0].read_text(encoding="utf-8"))

        # 崩溃时：已完成的动作有结果，正在执行的动作留有 pending 意图
        self.assertEqual(journal["status"], "running")
        self.assertEqual(len(journal["items"]), 3)
        self.assertEqual(journal["items"][0]["status"], "success")
        self.assertEqual(journal["items"][1]["status"], "success")
        self.assertEqual(journal["items"][2]["status"], "pending")
        self.assertEqual(
            journal["items"][2]["source_before"],
            str((self.base_dir / "second.txt").resolve()),
        )
        self.assertEqual(
            journal["items"][2]["target_after"],
            str((self.base_dir / "Docs" / "second.txt").resolve()),
        )

    def test_execute_plan_records_file_identity_for_moves(self):
        source = self.base_dir / "demo.txt"
        source.write_text("demo-content", encoding="utf-8")
        expected_size = source.stat().st_size
        expected_mtime = source.stat().st_mtime
        parsed = organizer_service.parse_commands_block(
            '<COMMANDS>\nMKDIR "Projects"\nMOVE "demo.txt" "Projects/demo.txt"\n</COMMANDS>'
        )
        plan = execution_service.build_execution_plan(parsed, self.base_dir)
        executions_dir = self.history_root / "executions"
        latest_path = self.history_root / "latest_by_directory.json"

        with mock.patch.object(execution_service.config, "EXECUTION_LOG_DIR", executions_dir), \
             mock.patch.object(execution_service.config, "LATEST_BY_DIRECTORY_PATH", latest_path):
            execution_service.execute_plan(plan)

        journal_files = list(executions_dir.glob("*.json"))
        journal = json.loads(journal_files[0].read_text(encoding="utf-8"))
        move_item = journal["items"][1]

        self.assertEqual(move_item["action_type"], "MOVE")
        self.assertEqual(move_item["size_bytes"], expected_size)
        self.assertAlmostEqual(move_item["mtime"], expected_mtime, places=3)
        # MKDIR 不记录文件身份
        self.assertIsNone(journal["items"][0]["size_bytes"])

    def test_journal_item_from_dict_tolerates_old_and_unknown_fields(self):
        from file_pilot.execution.models import ExecutionJournalItem

        legacy = ExecutionJournalItem.from_dict(
            {"action_type": "MOVE", "status": "success", "message": "移动成功"}
        )
        self.assertIsNone(legacy.size_bytes)
        self.assertIsNone(legacy.decision_basis)

        futuristic = ExecutionJournalItem.from_dict(
            {
                "action_type": "MOVE",
                "status": "success",
                "message": "移动成功",
                "some_future_field": "ignored",
            }
        )
        self.assertEqual(futuristic.action_type, "MOVE")

    def test_journal_round_trips_rule_snapshot(self):
        from file_pilot.execution.models import ExecutionJournal

        journal = ExecutionJournal(
            execution_id="exec1",
            target_dir=str(self.base_dir.resolve()),
            created_at="2026-07-26T00:00:00+00:00",
            status="completed",
            rule_snapshot={
                "profile_id": "p1",
                "directories": [{"path": "D:/archive/docs", "description": "技术手册与 API 文档"}],
            },
        )

        restored = ExecutionJournal.from_dict(journal.to_dict())

        self.assertEqual(restored.rule_snapshot["profile_id"], "p1")
        self.assertEqual(len(restored.rule_snapshot["directories"]), 1)

    def test_latest_execution_pointer_is_overwritten_for_same_directory(self):
        (self.base_dir / "first.txt").write_text("first", encoding="utf-8")
        parsed = organizer_service.parse_commands_block(
            '<COMMANDS>\nMKDIR "Docs"\nMOVE "first.txt" "Docs/first.txt"\n</COMMANDS>'
        )
        plan = execution_service.build_execution_plan(parsed, self.base_dir)
        executions_dir = self.history_root / "executions"
        latest_path = self.history_root / "latest_by_directory.json"

        with mock.patch.object(execution_service.config, "EXECUTION_LOG_DIR", executions_dir), \
             mock.patch.object(execution_service.config, "LATEST_BY_DIRECTORY_PATH", latest_path):
            execution_service.execute_plan(plan)

            (self.base_dir / "second.txt").write_text("second", encoding="utf-8")
            second_parsed = organizer_service.parse_commands_block(
                '<COMMANDS>\nMKDIR "Review"\nMOVE "second.txt" "Review/second.txt"\n</COMMANDS>'
            )
            second_plan = execution_service.build_execution_plan(second_parsed, self.base_dir)
            execution_service.execute_plan(second_plan)

        latest_index = json.loads(latest_path.read_text(encoding="utf-8"))
        latest_execution_id = latest_index[str(self.base_dir.resolve())]
        latest_journal = json.loads((executions_dir / f"{latest_execution_id}.json").read_text(encoding="utf-8"))

        self.assertEqual(
            latest_journal["items"][-1]["target_after"],
            str((self.base_dir / "Review" / "second.txt").resolve()),
        )


if __name__ == "__main__":
    unittest.main()



    def test_load_execution_journal_reconciles_crashed_run(self):
        (self.base_dir / "first.txt").write_text("first", encoding="utf-8")
        (self.base_dir / "second.txt").write_text("second", encoding="utf-8")
        parsed = organizer_service.parse_commands_block(
            '<COMMANDS>\n'
            'MKDIR "Docs"\n'
            'MOVE "first.txt" "Docs/first.txt"\n'
            'MOVE "second.txt" "Docs/second.txt"\n'
            '</COMMANDS>'
        )
        plan = execution_service.build_execution_plan(parsed, self.base_dir)
        executions_dir = self.history_root / "executions"
        latest_path = self.history_root / "latest_by_directory.json"

        original_move = shutil.move

        def crashing_move(src, dst):
            if Path(src).name == "second.txt":
                raise KeyboardInterrupt("simulated crash")
            return original_move(src, dst)

        with mock.patch.object(execution_service.config, "EXECUTION_LOG_DIR", executions_dir),              mock.patch.object(execution_service.config, "LATEST_BY_DIRECTORY_PATH", latest_path):
            with mock.patch("file_pilot.execution.service.shutil.move", side_effect=crashing_move):
                with self.assertRaises(KeyboardInterrupt):
                    execution_service.execute_plan(plan)

            execution_id = next(iter(executions_dir.glob("*.json"))).stem
            journal = execution_service.load_execution_journal(execution_id)

            # 对账：pending 意图落定（second.txt 未移动 → skipped），status 不再是 running
            assert journal is not None
            self.assertEqual(journal.status, "partial_failure")
            statuses = [item.status for item in journal.items]
            self.assertNotIn("pending", statuses)
            second_item = journal.items[-1]
            self.assertEqual(second_item.status, "skipped")
            # 最近执行指针补上，回退入口指向真实动过文件的这次执行
            latest_index = json.loads(latest_path.read_text(encoding="utf-8"))
            self.assertEqual(latest_index[str(self.base_dir.resolve())], execution_id)

    def test_load_execution_journal_reconciles_move_that_actually_happened(self):
        from file_pilot.execution.models import ExecutionJournal, ExecutionJournalItem

        (self.base_dir / "Docs").mkdir()
        moved_target = self.base_dir / "Docs" / "gone.txt"
        moved_target.write_text("moved", encoding="utf-8")
        executions_dir = self.history_root / "executions"
        latest_path = self.history_root / "latest_by_directory.json"
        journal = ExecutionJournal(
            execution_id="crash-1",
            target_dir=str(self.base_dir.resolve()),
            created_at="2026-07-26T00:00:00+00:00",
            status="running",
            items=[
                ExecutionJournalItem(
                    action_type="MOVE",
                    status="pending",
                    message="",
                    source_before=str((self.base_dir / "gone.txt").resolve()),
                    target_after=str(moved_target.resolve()),
                )
            ],
        )

        with mock.patch.object(execution_service.config, "EXECUTION_LOG_DIR", executions_dir),              mock.patch.object(execution_service.config, "LATEST_BY_DIRECTORY_PATH", latest_path):
            execution_service.save_execution_journal(journal)
            reconciled = execution_service.load_execution_journal("crash-1")

        # 目标已出现且来源已消失 → 判定移动已完成，可参与回退
        assert reconciled is not None
        self.assertEqual(reconciled.items[0].status, "success")
        self.assertEqual(reconciled.status, "partial_failure")

    def test_execute_plan_skips_move_when_parent_dir_missing_at_runtime(self):
        (self.base_dir / "demo.txt").write_text("demo", encoding="utf-8")
        parsed = organizer_service.parse_commands_block(
            '<COMMANDS>\nMOVE "demo.txt" "Missing/demo.txt"\n</COMMANDS>'
        )
        plan = execution_service.build_execution_plan(parsed, self.base_dir)

        report = execution_service.execute_plan(plan)

        # 预检对用户说「将跳过」的项，执行时不能变成「失败」
        self.assertEqual(report.failure_count, 0)
        self.assertEqual(report.skipped_count, 1)
        self.assertTrue((self.base_dir / "demo.txt").exists())
