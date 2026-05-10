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

