import unittest

from file_pilot.app.source_payloads import (
    build_planner_items_from_scan_lines,
    planner_items_from_source_refs,
    scan_entries_from_planner_items,
    source_refs_from_planner_items,
)
from file_pilot.domain.models import SourceRef


class SourcePayloadTests(unittest.TestCase):
    def test_build_planner_items_reuses_existing_ids_and_appends_new_ids(self):
        items = build_planner_items_from_scan_lines(
            "\n".join(
                [
                    "docs/plan.md | file | 技术设计 | 架构设计文档",
                    "notes/todo.txt | file | 待处理 | 临时记录",
                ]
            ),
            existing_items=[
                {
                    "planner_id": "F007",
                    "source_relpath": "docs/plan.md",
                    "display_name": "plan.md",
                }
            ],
        )

        self.assertEqual([item["planner_id"] for item in items], ["F007", "F008"])
        self.assertEqual(items[0]["summary"], "架构设计文档")
        self.assertEqual(items[1]["source_relpath"], "notes/todo.txt")

    def test_planner_items_and_source_refs_roundtrip_structured_fields(self):
        refs = source_refs_from_planner_items(
            [
                {
                    "planner_id": "F003",
                    "source_relpath": "docs/plan.md",
                    "display_name": "plan.md",
                    "entry_type": "file",
                    "suggested_purpose": "技术设计",
                    "summary": "架构设计文档",
                    "confidence": 0.8,
                    "ext": "md",
                }
            ],
            default_origin="D:/workspace/Inbox",
        )

        self.assertEqual(refs[0].ref_id, "F003")
        self.assertEqual(refs[0].origin, "D:/workspace/Inbox")
        self.assertEqual(refs[0].content_summary, "架构设计文档")

        items = planner_items_from_source_refs(refs)
        self.assertEqual(items[0]["planner_id"], "F003")
        self.assertEqual(items[0]["source_relpath"], "docs/plan.md")
        self.assertEqual(items[0]["summary"], "架构设计文档")

    def test_scan_entries_can_be_derived_from_structured_planner_items(self):
        entries = scan_entries_from_planner_items(
            [
                {
                    "planner_id": "F001",
                    "source_relpath": "docs/plan.md",
                    "display_name": "plan.md",
                    "entry_type": "file",
                    "suggested_purpose": "技术设计",
                    "summary": "架构设计文档",
                }
            ]
        )

        self.assertEqual(entries[0]["item_id"], "docs/plan.md")
        self.assertEqual(entries[0]["ext"], "md")

    def test_planner_items_from_source_refs_uses_ref_id_as_planner_id(self):
        items = planner_items_from_source_refs(
            [
                SourceRef(
                    ref_id="legacy-id",
                    display_name="todo.txt",
                    entry_type="file",
                    origin="D:/workspace/Inbox",
                    relpath="notes/todo.txt",
                    suggested_purpose="待处理",
                    content_summary="临时记录",
                    ext="txt",
                )
            ]
        )

        self.assertEqual(items[0]["planner_id"], "legacy-id")
        self.assertEqual(items[0]["source_relpath"], "notes/todo.txt")


if __name__ == "__main__":
    unittest.main()
