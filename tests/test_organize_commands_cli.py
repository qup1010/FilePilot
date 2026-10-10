import shutil
import unittest
from pathlib import Path
from unittest import mock

from file_pilot.organize import service as organizer_service


class OrganizerCompatibilityTests(unittest.TestCase):
    def test_get_scan_content_rejects_missing_file(self):
        result_file = Path("test_temp_organizer_output") / "missing.txt"
        if result_file.parent.exists():
            shutil.rmtree(result_file.parent)

        with mock.patch.object(organizer_service, "RESULT_FILE_PATH", result_file):
            with self.assertRaises(FileNotFoundError):
                organizer_service.get_scan_content()

    def test_build_initial_messages_includes_scan_lines(self):
        scan_lines = "合同.pdf | 财务/合同 | 付款协议"

        messages = organizer_service.build_initial_messages(scan_lines)

        self.assertEqual(messages[0]["role"], "system")
        self.assertIn(scan_lines, messages[0]["content"])
        self.assertNotIn("<<<SCAN_LINES>>>", messages[0]["content"])

    def test_build_initial_messages_constrains_display_markdown_and_internal_ids(self):
        messages = organizer_service.build_initial_messages("F001 | file | 合同.pdf | 财务 | 付款协议")
        prompt = messages[0]["content"]

        self.assertIn("### 本轮调整", prompt)
        self.assertIn("### 需要你确认", prompt)
        self.assertIn("### 下一步", prompt)
        self.assertIn("禁止暴露内部编号", prompt)
        self.assertIn("F001", prompt)

    def test_english_planning_uses_english_headings_and_preserves_scan_text(self):
        scan_lines = "F001 | file | contract.pdf | finance | payment agreement"
        messages = organizer_service.build_initial_messages(
            scan_lines,
            planning_context={"content_locale": "en"},
        )

        prompt = messages[0]["content"]
        self.assertIn("### Changes this round", prompt)
        self.assertIn("### Needs your review", prompt)
        self.assertIn("### Next step", prompt)
        self.assertIn("Write all user-facing natural-language replies in English", prompt)
        self.assertNotIn("### 本轮调整", prompt)
        self.assertIn(scan_lines, prompt)
        self.assertIn("Create an organization plan from the directory scan", messages[1]["content"])

        source_text = "F002 | file | ### 本轮调整 | finance | quoted source"
        source_prompt = organizer_service.build_initial_messages(
            source_text,
            planning_context={"content_locale": "en"},
        )[0]["content"]
        self.assertIn(source_text, source_prompt)
        self.assertIn("### Changes this round", source_prompt)

    def test_english_planning_retry_and_repair_keep_output_language(self):
        validation = {
            "missing": ["contract.pdf"],
            "extra": [],
            "duplicates": [],
            "order_errors": [],
            "invalid_lines": [],
            "path_errors": [],
            "rename_errors": [],
            "duplicate_mkdirs": [],
            "missing_mkdirs": [],
            "unused_mkdirs": [],
            "conflicting_targets": [],
        }
        planning_context = {
            "content_locale": "en",
            "organize_mode": "incremental",
            "target_directories": ["Finance"],
            "target_slots": [{"slot_id": "D001", "relpath": "Finance", "depth": 0}],
        }

        retry = organizer_service.build_command_retry_message(
            validation,
            scan_lines="F001 | file | contract.pdf | finance | payment agreement",
            planning_context=planning_context,
        )
        repair = organizer_service._build_repair_messages(
            "F001 | file | contract.pdf | finance | payment agreement",
            [],
            validation,
            planning_context=planning_context,
        )

        self.assertIn("The previous organization plan failed structural validation.", retry)
        self.assertIn("Missing moves", retry)
        self.assertIn("Hard constraints for placing items into existing folders", repair[1]["content"])
        self.assertIn("Write all user-facing natural language in English", repair[0]["content"])
        self.assertNotIn("最近一次失败原因", repair[1]["content"])

    def test_sanitize_assistant_display_content_hides_internal_ids(self):
        content = organizer_service._sanitize_assistant_display_content(
            "### 本轮调整\n- F001 使用 target_slot D001，item_id 已更新。"
        )

        self.assertNotIn("F001", content)
        self.assertNotIn("D001", content)
        self.assertNotIn("target_slot", content)
        self.assertNotIn("item_id", content)

    def test_build_command_retry_message_lists_validation_errors(self):
        validation = {
            "missing": ["合同.pdf"],
            "extra": [],
            "duplicates": [],
            "order_errors": [],
            "invalid_lines": [],
            "path_errors": [],
            "rename_errors": [],
            "duplicate_mkdirs": [],
            "missing_mkdirs": [],
            "unused_mkdirs": [],
            "conflicting_targets": [],
        }

        message = organizer_service.build_command_retry_message(validation)

        self.assertIn("缺少 MOVE", message)
        self.assertIn("合同.pdf", message)


if __name__ == "__main__":
    unittest.main()

