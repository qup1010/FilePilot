import unittest

from file_pilot.icon_workbench.client import IconWorkbenchTextClient
from file_pilot.icon_workbench.models import ModelConfig
from file_pilot.icon_workbench.prompts import TEXT_ANALYSIS_SYSTEM_PROMPT


class RecordingTextClient(IconWorkbenchTextClient):
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def complete_json(self, config, system_prompt, user_prompt, *, temperature=0.3):
        self.calls.append(
            {
                "config": config,
                "system_prompt": system_prompt,
                "user_prompt": user_prompt,
                "temperature": temperature,
            }
        )
        return dict(self.payload)


class IconWorkbenchClientTests(unittest.TestCase):
    def test_analyze_folder_includes_parent_folder_context(self):
        client = RecordingTextClient(
            {
                "category": "音乐素材",
                "visual_subject": "a musical note and headphones",
                "summary": "父目录和文件名都指向音乐内容。",
            }
        )

        result = client.analyze_folder(
            ModelConfig(base_url="https://example.com/v1", api_key="key", model="gpt"),
            "D:/Media/Music/Lofi",
            "Lofi",
            ["├─ chill.wav", "└─ covers/"],
        )

        self.assertEqual(result.visual_subject, "a musical note and headphones")
        self.assertIn("父级文件夹名称: Music", client.calls[0]["user_prompt"])
        self.assertIn("当前文件夹名称: Lofi", client.calls[0]["user_prompt"])
        self.assertIn("目录树摘要:", client.calls[0]["user_prompt"])

    def test_analyze_folder_falls_back_to_folder_name_when_subject_missing(self):
        client = RecordingTextClient(
            {
                "category": "项目源码",
                "visual_subject": "",
                "summary": "目录以源码文件为主。",
            }
        )

        result = client.analyze_folder(
            ModelConfig(base_url="https://example.com/v1", api_key="key", model="gpt"),
            "D:/Projects/RustTools",
            "RustTools",
            ["├─ src/", "└─ Cargo.toml"],
        )

        self.assertEqual(result.visual_subject, "RustTools")
        self.assertIn("RustTools", result.suggested_prompt)

    def test_analysis_prompt_has_stronger_visual_subject_constraints(self):
        self.assertIn("父级/上层目录名称", TEXT_ANALYSIS_SYSTEM_PROMPT)
        self.assertIn("提高名称线索的权重", TEXT_ANALYSIS_SYSTEM_PROMPT)
        self.assertIn("严禁出现这些类型的词", TEXT_ANALYSIS_SYSTEM_PROMPT)
        self.assertIn("优先可图标化", TEXT_ANALYSIS_SYSTEM_PROMPT)


if __name__ == "__main__":
    unittest.main()
