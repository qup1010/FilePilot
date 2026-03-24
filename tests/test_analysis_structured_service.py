import shutil
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from file_organizer.analysis.models import AnalysisItem
from file_organizer.analysis import service as analysis_service


class StructuredAnalysisServiceTests(unittest.TestCase):
    def setUp(self):
        self.base_dir = Path("test_temp_analysis_structured")
        if self.base_dir.exists():
            shutil.rmtree(self.base_dir)
        self.base_dir.mkdir()
        (self.base_dir / "合同.pdf").write_text("demo", encoding="utf-8")
        (self.base_dir / "Screenshots").mkdir()

    def tearDown(self):
        if self.base_dir.exists():
            shutil.rmtree(self.base_dir)

    def test_render_analysis_items_preserves_compatible_scan_format(self):
        items = [
            AnalysisItem(
                entry_name="合同.pdf",
                entry_type="file",
                suggested_purpose="财务/合同",
                summary="付款协议",
                evidence_sources=["filename", "pdf_text"],
                confidence=0.92,
            )
        ]

        rendered = analysis_service.render_analysis_items(items)

        self.assertIn("合同.pdf | 财务/合同 | 付款协议", rendered)
        self.assertNotIn("confidence", rendered)

    def test_validate_analysis_items_accepts_current_level_entries(self):
        items = [
            AnalysisItem(
                entry_name="合同.pdf",
                entry_type="file",
                suggested_purpose="财务/合同",
                summary="付款协议",
                evidence_sources=["filename"],
                confidence=0.9,
            ),
            AnalysisItem(
                entry_name="Screenshots",
                entry_type="dir",
                suggested_purpose="截图记录",
                summary="软件报错截图",
                evidence_sources=["directory_listing"],
                confidence=0.7,
            ),
        ]

        validation = analysis_service.validate_analysis_items(items, self.base_dir)

        self.assertTrue(validation["is_valid"])
        self.assertEqual(validation["missing"], [])
        self.assertEqual(validation["extra"], [])

    def test_validate_analysis_items_normalizes_relative_and_absolute_entry_names(self):
        items = [
            AnalysisItem(entry_name="./合同.pdf", suggested_purpose="财务/合同", summary="付款协议"),
            AnalysisItem(
                entry_name=str((self.base_dir / "Screenshots").resolve()),
                suggested_purpose="截图记录",
                summary="软件报错截图",
            ),
        ]

        validation = analysis_service.validate_analysis_items(items, self.base_dir)

        self.assertTrue(validation["is_valid"])
        self.assertEqual(validation["missing"], [])
        self.assertEqual(validation["extra"], [])

    def test_append_output_result_accepts_structured_items(self):
        items = [
            AnalysisItem(
                entry_name="合同.pdf",
                entry_type="file",
                suggested_purpose="财务/合同",
                summary="付款协议",
                evidence_sources=["filename"],
                confidence=0.9,
            )
        ]
        result_file = self.base_dir / "result.txt"

        with mock.patch.object(analysis_service, "RESULT_FILE_PATH", result_file):
            saved_path = analysis_service.append_output_result(items)

        self.assertEqual(saved_path, result_file)
        self.assertIn("合同.pdf | 财务/合同 | 付款协议", result_file.read_text(encoding="utf-8"))

    def test_run_analysis_cycle_emits_wait_events_around_model_request(self):
        submitted_items = [
            AnalysisItem(
                entry_name="合同.pdf",
                entry_type="file",
                suggested_purpose="财务/合同",
                summary="付款协议",
                evidence_sources=["filename"],
                confidence=0.9,
            ),
            AnalysisItem(
                entry_name="Screenshots",
                entry_type="dir",
                suggested_purpose="截图记录",
                summary="软件报错截图",
                evidence_sources=["directory_listing"],
                confidence=0.7,
            ),
        ]
        tool_call = SimpleNamespace(
            function=SimpleNamespace(
                name=analysis_service.SUBMIT_ANALYSIS_TOOL_NAME,
                arguments='{"items": [{"entry_name": "合同.pdf", "entry_type": "file", "suggested_purpose": "财务/合同", "summary": "付款协议", "evidence_sources": ["filename"], "confidence": 0.9}, {"entry_name": "Screenshots", "entry_type": "dir", "suggested_purpose": "截图记录", "summary": "软件报错截图", "evidence_sources": ["directory_listing"], "confidence": 0.7}]}'
            )
        )
        response = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(tool_calls=[tool_call], content=""))]
        )
        client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=mock.Mock(return_value=response))))
        events = []

        with mock.patch.object(analysis_service, "get_client", return_value=client), mock.patch.object(
            analysis_service, "list_local_files", return_value="示例文件列表"
        ):
            rendered = analysis_service.run_analysis_cycle(self.base_dir, event_handler=lambda event, data=None: events.append(event))

        self.assertEqual(rendered, analysis_service.render_analysis_items(submitted_items))
        self.assertIn("model_wait_start", events)
        self.assertIn("model_wait_end", events)
        self.assertLess(events.index("model_wait_start"), events.index("model_wait_end"))

    def test_validate_analysis_returns_duplicates_key_for_missing_output(self):
        validation = analysis_service.validate_analysis("", self.base_dir)

        self.assertFalse(validation["is_valid"])
        self.assertIn("duplicates", validation)
        self.assertEqual(validation["duplicates"], [])


if __name__ == "__main__":
    unittest.main()
