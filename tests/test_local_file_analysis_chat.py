import shutil
import unittest
from pathlib import Path
from unittest import mock

from file_organizer.analysis import service as scanner_service
from file_organizer.organize import service as organizer_service


class ScannerServiceTests(unittest.TestCase):
    def test_build_system_prompt_requires_structured_submission(self):
        system_prompt = scanner_service.build_system_prompt("示例文件列表")

        self.assertIn("submit_analysis_result", system_prompt)
        self.assertIn("items", system_prompt)
        self.assertIn("当前层", system_prompt)

    def test_build_system_prompt_describes_image_and_archive_capabilities(self):
        system_prompt = scanner_service.build_system_prompt("示例文件列表")

        self.assertIn("图片", system_prompt)
        self.assertIn("zip", system_prompt.lower())
        self.assertIn("简短摘要", system_prompt)
        self.assertIn("编码", system_prompt)

    def test_tool_list_contains_submission_and_reading_tools(self):
        tool_names = [tool["function"]["name"] for tool in scanner_service.tools]

        self.assertIn("read_local_file", tool_names)
        self.assertIn("list_local_files", tool_names)
        self.assertIn("submit_analysis_result", tool_names)

    def test_read_local_file_tool_description_mentions_new_capabilities(self):
        read_tool = next(tool for tool in scanner_service.tools if tool["function"]["name"] == "read_local_file")
        description = read_tool["function"]["description"]

        self.assertIn("图片", description)
        self.assertIn("zip", description.lower())
        self.assertIn("编码", description)

    def test_organizer_prompt_requires_diff_display_and_final_tools(self):
        prompt = organizer_service.build_prompt("合同.pdf | 财务/合同 | 付款协议")

        self.assertIn("submit_plan_diff", prompt)
        self.assertNotIn("submit_plan_patch", prompt)
        self.assertIn("present_current_plan", prompt)
        self.assertIn("submit_final_plan", prompt)
        self.assertIn("unresolved_items", prompt)

    def test_organizer_prompt_restores_classification_rules_and_diff_semantics(self):
        prompt = organizer_service.build_prompt("合同.pdf | 财务/合同 | 付款协议")

        self.assertIn("若用途不明确，再结合“内容摘要”判断", prompt)
        self.assertIn("若到最终提交前仍无法判断，则归入 Review", prompt)
        self.assertIn("目录尽量少", prompt)
        self.assertIn("同一用途的项目应尽量进入同一目录", prompt)
        self.assertIn("Finance > Documents", prompt)
        self.assertIn("Projects > Documents", prompt)
        self.assertIn("Study > Media", prompt)
        self.assertIn("Screenshots > Media", prompt)
        self.assertIn("submit_plan_diff", prompt)
        self.assertIn("directory_renames", prompt)
        self.assertIn("move_updates", prompt)
        self.assertIn("未回答则归入 Review", prompt)

    def test_organizer_prompt_describes_directory_semantics_and_user_preference_priority(self):
        prompt = organizer_service.build_prompt("合同.pdf | 财务/合同 | 付款协议")

        self.assertIn("Installers：安装包、安装程序、软件分发文件", prompt)
        self.assertIn("Projects：项目代码、项目文档、项目资源", prompt)
        self.assertIn("Finance：合同、账单、发票、报销、付款记录等财务相关内容", prompt)
        self.assertIn("Archives：备份、历史归档、旧资料；不能仅因为是压缩包就放入此类", prompt)
        self.assertIn("若用户没有明确要求，优先复用推荐目录名", prompt)
        self.assertIn("若用户明确指定目录命名或归类方式，应优先遵循用户偏好", prompt)
        self.assertIn("默认展示“摘要视图”", prompt)
        self.assertIn("summary", prompt)
        self.assertIn("details", prompt)
        self.assertIn("不要在自然语言中重复完整计划", prompt)
        self.assertNotIn("目标路径必须与原路径一致", prompt)

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



