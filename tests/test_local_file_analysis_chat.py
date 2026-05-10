import shutil
import unittest
from pathlib import Path
from unittest import mock

from file_pilot.analysis import service as scanner_service
from file_pilot.organize import service as organizer_service


class ScannerServiceTests(unittest.TestCase):
    def test_build_system_prompt_requires_structured_submission(self):
        system_prompt = scanner_service.build_system_prompt("示例文件列表")

        self.assertIn("submit_analysis_result", system_prompt)
        self.assertIn("items", system_prompt)
        self.assertIn("当前层", system_prompt)

    def test_build_system_prompt_describes_local_file_and_submission_capabilities(self):
        system_prompt = scanner_service.build_system_prompt("示例文件列表")

        self.assertIn("read_local_files_batch", system_prompt)
        self.assertIn("submit_analysis_result", system_prompt)
        self.assertIn("summary", system_prompt)
        self.assertIn("一一对应", system_prompt)

    def test_tool_list_contains_submission_and_reading_tools(self):
        tool_names = [tool["function"]["name"] for tool in scanner_service.tools]

        self.assertIn("read_local_files_batch", tool_names)
        self.assertIn("submit_analysis_result", tool_names)

    def test_read_local_files_batch_tool_description_mentions_capabilities(self):
        read_tool = next(tool for tool in scanner_service.tools if tool["function"]["name"] == "read_local_files_batch")
        description = read_tool["function"]["description"]

        self.assertIn("批量", description)
        self.assertIn("zip", description.lower())

    def test_organizer_prompt_requires_diff_focus_and_review_based_unresolved_flow(self):
        prompt = organizer_service.build_prompt("合同.pdf | 财务/合同 | 付款协议")

        self.assertIn("submit_plan_diff", prompt)
        self.assertNotIn("submit_plan_patch", prompt)
        self.assertNotIn("request_unresolved_choices", prompt)
        self.assertNotIn("submit" + "_final_plan", prompt)
        self.assertIn("unresolved_adds", prompt)
        self.assertIn("unresolved_removals", prompt)
        self.assertIn("右侧预览区确认", prompt)
        self.assertIn("只包含 4 个字段", prompt)

    def test_organizer_prompt_restores_classification_rules_and_diff_semantics(self):
        prompt = organizer_service.build_prompt("合同.pdf | 财务/合同 | 付款协议")

        self.assertIn("若用途仍不明确，再结合“内容摘要”判断", prompt)
        self.assertIn("不要过度细分", prompt)
        self.assertIn("按实际用途归到清晰的大类", prompt)
        self.assertIn("submit_plan_diff", prompt)
        self.assertIn("directory_renames", prompt)
        self.assertIn("move_updates", prompt)
        self.assertIn("不要生成候选目录", prompt)

    def test_organizer_prompt_describes_directory_semantics_and_user_preference_priority(self):
        prompt = organizer_service.build_prompt("合同.pdf | 财务/合同 | 付款协议")

        self.assertIn("优先考虑的目录语义：项目资料、财务票据、学习资料、安装程序、截图记录、媒体素材、历史归档", prompt)
        self.assertNotIn("优先考虑的目录语义：项目资料、财务票据、学习资料、安装程序、截图记录、媒体素材、历史归档、待确认", prompt)
        self.assertIn("目录语言：优先使用简洁、自然、统一的中文目录名", prompt)
        self.assertIn("整理保守度：平衡", prompt)
        self.assertIn("允许为清晰结构创建适量目录，但不要过度细分", prompt)
        self.assertIn("当前固定整理策略（必须优先遵守）", prompt)
        self.assertIn("summary", prompt)
        self.assertNotIn("submit" + "_final_plan", prompt)

    def test_append_output_result_extracts_output_block(self):
        output_dir = Path("test_temp_scanner_output")
        result_file = output_dir / "result.txt"
        if output_dir.exists():
            shutil.rmtree(output_dir)
        output_dir.mkdir()
        content = "前缀说明\n<output>\n第一段结果\n</output>\n尾部说明"

        try:
            with mock.patch.object(scanner_service, "RESULT_FILE_PATH", result_file):
                saved_path = scanner_service.append_output_result(content)

            self.assertEqual(saved_path, result_file)
            self.assertTrue(result_file.exists())
            saved_text = result_file.read_text(encoding="utf-8")
            self.assertIn("第一段结果", saved_text)
        finally:
            if output_dir.exists():
                shutil.rmtree(output_dir)


if __name__ == "__main__":
    unittest.main()



