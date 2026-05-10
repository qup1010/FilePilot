import json
import unittest
from pathlib import Path

from file_pilot.organize import service as organizer_service
from file_pilot.organize.prompts import build_prompt
from file_pilot.organize.strategy_templates import build_preview_directories


class OrganizerServiceTests(unittest.TestCase):
    def test_parse_commands_block_extracts_mkdir_and_move(self):
        parsed = organizer_service.parse_commands_block(
            '<COMMANDS>\nMKDIR "Finance"\nMOVE "合同.pdf" "Finance/合同.pdf"\n</COMMANDS>'
        )

        self.assertTrue(parsed["has_commands"])
        self.assertEqual(parsed["mkdirs"], ["Finance"])
        self.assertEqual(len(parsed["moves"]), 1)
        self.assertEqual(parsed["moves"][0]["source"], "合同.pdf")
        self.assertEqual(parsed["moves"][0]["target"], "Finance/合同.pdf")

    def test_validate_command_flow_accepts_valid_command_sequence(self):
        scan_lines = "合同.pdf | 财务/合同 | 付款协议\n截图1.png | 截图记录 | 报错界面"
        content = (
            "<COMMANDS>\n"
            'MKDIR "Finance"\n'
            'MKDIR "Screenshots"\n'
            'MOVE "合同.pdf" "Finance/合同.pdf"\n'
            'MOVE "截图1.png" "Screenshots/截图1.png"\n'
            "</COMMANDS>"
        )

        validation = organizer_service.validate_command_flow(scan_lines, content)

        self.assertTrue(validation["is_valid"])

    def test_validate_command_flow_rejects_rename(self):
        scan_lines = "合同.pdf | 财务/合同 | 付款协议"
        content = '<COMMANDS>\nMKDIR "Finance"\nMOVE "合同.pdf" "Finance/已改名.pdf"\n</COMMANDS>'

        validation = organizer_service.validate_command_flow(scan_lines, content)

        self.assertFalse(validation["is_valid"])
        self.assertTrue(validation["rename_errors"])

    def test_build_prompt_injects_selected_strategy_rules(self):
        prompt = build_prompt(
            "合同.pdf | 财务/合同 | 付款协议",
            {
                "template_id": "office_admin",
                "language": "en",
                "density": "minimal",
                "prefix_style": "category",
                "caution_level": "conservative",
                "note": "票据优先归财务目录",
            },
        )

        self.assertIn("办公事务", prompt)
        self.assertIn("英文目录", prompt)
        self.assertIn("分类粒度：极简", prompt)
        self.assertIn("类别标签前缀", prompt)
        self.assertIn("整理保守度：保守", prompt)
        self.assertIn("票据优先归财务目录", prompt)

    def test_build_prompt_keeps_review_internal_and_avoids_full_repetition(self):
        prompt = build_prompt("F001 | file | 合同.pdf | 财务合同 | 付款协议")

        self.assertIn("只在 `unresolved_adds` 中登记", prompt)
        self.assertIn("系统会自动映射到待确认区", prompt)
        self.assertIn("不要把 `Review` 作为用户可见名称", prompt)
        self.assertIn("不要重复上一轮完整说明", prompt)
        self.assertIn("如果界面已显示可检查，请点击‘检查移动风险’", prompt)
        self.assertNotIn("当前整理草案已满足预检条件", prompt)

    def test_build_prompt_incremental_forbids_new_target_directories(self):
        prompt = build_prompt(
            "F001 | file | 合同.pdf | 财务合同 | 付款协议",
            planning_context={
                "organize_mode": "incremental",
                "target_directories": ["Finance"],
                "target_slots": [{"slot_id": "D001", "relpath": "Finance", "depth": 0}],
            },
        )

        self.assertIn("禁止创建新目标目录", prompt)
        self.assertIn("target_dir 必须精确等于某个已选目标目录", prompt)
        self.assertIn("或交给系统放入待确认区", prompt)
        self.assertNotIn("只能放入显式配置的目标目录，或放入 Review", prompt)

    def test_build_prompt_incremental_includes_target_directory_descriptions(self):
        prompt = build_prompt(
            "F001 | file | 合同.pdf | 财务合同 | 付款协议",
            planning_context={
                "organize_mode": "incremental",
                "target_directories": ["D:/archive/docs"],
                "target_directory_details": [
                    {
                        "path": "D:/archive/docs",
                        "label": "文档库",
                        "description": "适合合同、说明书和项目交付文档",
                    }
                ],
            },
        )

        self.assertIn("D:/archive/docs（标签：文档库；说明：适合合同、说明书和项目交付文档）", prompt)

    def test_build_preview_directories_applies_density_and_prefix_style(self):
        preview = build_preview_directories(
            "media_assets",
            language="zh",
            density="minimal",
            prefix_style="numeric",
        )

        self.assertEqual(preview[:3], ["01_截图", "02_媒体", "03_设计"])

    def test_strategy_catalog_does_not_expose_review_as_candidate_directory(self):
        catalog_path = Path(__file__).resolve().parents[1] / "frontend" / "src" / "lib" / "strategy-catalog.json"
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))

        def walk(value):
            if isinstance(value, dict):
                if value.get("id") == "review":
                    self.fail("strategy catalog must not expose review as a candidate directory")
                for child in value.values():
                    walk(child)
            elif isinstance(value, list):
                for child in value:
                    walk(child)

        walk(catalog)


if __name__ == "__main__":
    unittest.main()
