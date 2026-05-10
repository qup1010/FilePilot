import unittest

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


if __name__ == "__main__":
    unittest.main()
