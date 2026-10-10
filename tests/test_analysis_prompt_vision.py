import unittest

from file_pilot.analysis import service as analysis_service
from file_pilot.analysis.prompts import build_system_prompt


class AnalysisPromptVisionTests(unittest.TestCase):
    def test_build_system_prompt_allows_model_to_decide_when_vision_enabled(self):
        prompt = build_system_prompt("示例文件列表", vision_enabled=True)

        self.assertIn("只有当图片文件名不足以稳妥判断内容时", prompt)
        self.assertIn("你才可以使用 read_local_files_batch 查看图片识别结果", prompt)
        self.assertIn("不要为了求稳对所有图片都看图", prompt)

    def test_build_system_prompt_forbids_image_inspection_when_vision_disabled(self):
        prompt = build_system_prompt("示例文件列表", vision_enabled=False)

        self.assertIn("当前未开启图片理解", prompt)
        self.assertIn("请只根据文件名和扩展名判断用途", prompt)
        self.assertIn("不要为了图片内容再调用工具探查", prompt)

    def test_build_system_prompt_separates_purpose_and_summary_without_fabrication(self):
        prompt = build_system_prompt("示例文件列表", vision_enabled=False)

        self.assertIn("suggested_purpose 表示整理用途或类别倾向", prompt)
        self.assertIn("summary 表示条目内容、结构或可观察线索摘要", prompt)
        self.assertIn("不要和 suggested_purpose 互相复述", prompt)
        self.assertIn("如果没有实际读取文件内容或目录结构", prompt)
        self.assertIn("不能写具体内容细节", prompt)

    def test_english_prompt_and_tool_descriptions_preserve_the_structured_contract(self):
        prompt = build_system_prompt(
            "F001 | file | contract.pdf | finance | payment agreement",
            vision_enabled=True,
            content_locale="en",
        )

        self.assertIn("Write all generated suggested_purpose values and summaries in English.", prompt)
        self.assertIn("5–20 words", prompt)
        self.assertIn("no more than 120 characters", prompt)
        self.assertIn("Use read_local_files_batch once", prompt)
        self.assertNotIn("简洁中文输出", prompt)

        english_tools = analysis_service.analysis_tools_for_content_locale("en")
        chinese_tools = analysis_service.analysis_tools_for_content_locale("zh-CN")
        self.assertEqual(
            [tool["function"]["name"] for tool in english_tools],
            [tool["function"]["name"] for tool in chinese_tools],
        )

        english_submit = next(
            tool["function"] for tool in english_tools if tool["function"]["name"] == "submit_analysis_result"
        )
        chinese_submit = next(
            tool["function"] for tool in chinese_tools if tool["function"]["name"] == "submit_analysis_result"
        )
        english_properties = english_submit["parameters"]["properties"]["items"]["items"]["properties"]
        chinese_properties = chinese_submit["parameters"]["properties"]["items"]["items"]["properties"]
        self.assertEqual(english_properties.keys(), chinese_properties.keys())
        self.assertEqual(english_submit["name"], analysis_service.SUBMIT_ANALYSIS_TOOL_NAME)
        self.assertEqual(english_submit["parameters"]["required"], chinese_submit["parameters"]["required"])
        self.assertEqual(english_properties["entry_type"]["enum"], chinese_properties["entry_type"]["enum"])
        self.assertEqual(english_properties["entry_type"]["enum"], ["file", "dir"])
        self.assertIn("5–20 words", english_properties["summary"]["description"])
        self.assertIn("120 characters", english_properties["summary"]["description"])
        self.assertEqual(chinese_properties["summary"]["description"], "不超过四十字的内容摘要")
        retry_message = analysis_service._build_retry_message(
            {
                "missing": ["F001"],
                "extra": [],
                "duplicates": [],
                "image_probe_failures": ["F001"],
            },
            "selected entries",
            "en",
        )
        self.assertIn("The previous result did not pass validation", retry_message)
        self.assertIn("Do not invent visual details", retry_message)

    def test_english_image_fallback_remains_valid_after_recognition_failure(self):
        fallback = analysis_service._placeholder_analysis_item("image.png", "en")
        image_item = analysis_service.AnalysisItem(
            entry_name="image.png",
            entry_id="F001",
            suggested_purpose="Uncertain",
            summary="Image content could not be confirmed.",
        )

        self.assertEqual(fallback.suggested_purpose, "Uncertain")
        self.assertIn("manual review", fallback.summary)
        probe_statuses = analysis_service._extract_image_probe_statuses(
            "--- 条目 [F001 | image.png] 内容开始 ---\n"
            "--- Image recognition result starts ---\n"
            "status: failed\nerror_code: vision_request_failed\n"
            "--- Image recognition result ends ---\n"
            "--- 内容结束 ---"
        )
        self.assertEqual(probe_statuses["F001"]["status"], "failed")
        self.assertEqual(
            analysis_service._validate_failed_image_probe_items(
                [image_item],
                probe_statuses,
            ),
            [],
        )


if __name__ == "__main__":
    unittest.main()
