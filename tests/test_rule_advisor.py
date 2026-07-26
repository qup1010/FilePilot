import json
import shutil
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from file_pilot.app.models import TargetProfileDirectory
from file_pilot.app.session_service import OrganizerSessionService
from file_pilot.app.session_store import SessionStore
from file_pilot.organize import rule_advisor


def _fake_client(arguments: str):
    tool_call = SimpleNamespace(function=SimpleNamespace(arguments=arguments))
    message = SimpleNamespace(tool_calls=[tool_call])
    response = SimpleNamespace(choices=[SimpleNamespace(message=message)])
    client = mock.MagicMock()
    client.chat.completions.create.return_value = response
    return client


class RuleAdvisorTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_rule_advisor")
        if self.root.exists():
            shutil.rmtree(self.root)
        self.root.mkdir()

    def tearDown(self):
        if self.root.exists():
            shutil.rmtree(self.root)

    def test_collect_directory_content_profile_counts_extensions(self):
        target = self.root / "docs"
        target.mkdir()
        (target / "a.pdf").write_text("a", encoding="utf-8")
        (target / "b.pdf").write_text("b", encoding="utf-8")
        (target / "c.docx").write_text("c", encoding="utf-8")
        (target / "sub").mkdir()

        profile = rule_advisor.collect_directory_content_profile(target, label="文档")

        self.assertTrue(profile.readable)
        self.assertEqual(profile.total_entries, 4)
        self.assertEqual(profile.extension_counts["pdf"], 2)
        self.assertEqual(profile.extension_counts["docx"], 1)
        self.assertEqual(profile.extension_counts["<dir>"], 1)
        self.assertIn("a.pdf", profile.sample_names)

    def test_collect_directory_content_profile_marks_unreadable(self):
        profile = rule_advisor.collect_directory_content_profile(self.root / "missing")
        self.assertFalse(profile.readable)
        self.assertEqual(profile.total_entries, 0)

    def test_parse_rule_drafts_rejects_hallucinated_paths(self):
        arguments = json.dumps(
            {
                "drafts": [
                    {"path": "D:/known", "draft_description": "技术文档", "basis": "多为 PDF 手册"},
                    {"path": "D:/hallucinated", "draft_description": "不该出现", "basis": ""},
                ]
            }
        )

        drafts = rule_advisor.parse_rule_drafts(arguments, allowed_paths={"D:/known"})

        self.assertEqual(len(drafts), 1)
        self.assertEqual(drafts[0].path, "D:/known")

    def test_generate_rule_drafts_uses_forced_tool_call(self):
        profiles = [
            rule_advisor.DirectoryContentProfile(path="D:/known", label="文档", total_entries=3),
        ]
        client = _fake_client(
            json.dumps({"drafts": [{"path": "D:/known", "draft_description": "技术文档", "basis": "PDF 为主"}]})
        )

        drafts = rule_advisor.generate_rule_drafts(profiles, client=client, model="test-model")

        self.assertEqual(drafts[0].draft_description, "技术文档")
        call_kwargs = client.chat.completions.create.call_args.kwargs
        self.assertEqual(call_kwargs["model"], "test-model")
        self.assertEqual(call_kwargs["tool_choice"]["function"]["name"], "submit_rule_drafts")
        self.assertFalse(call_kwargs["stream"])


class TargetProfileRuleFieldsTests(unittest.TestCase):
    def test_directory_hard_conditions_round_trip(self):
        directory = TargetProfileDirectory.from_dict(
            {
                "path": "D:/archive/docs",
                "description": "技术手册",
                "extensions": [".PDF", "docx", "pdf", ""],
                "name_patterns": ["invoice_*", "invoice_*"],
            }
        )

        assert directory is not None
        self.assertEqual(directory.extensions, ["pdf", "docx"])
        self.assertEqual(directory.name_patterns, ["invoice_*"])
        restored = TargetProfileDirectory.from_dict(directory.to_dict())
        assert restored is not None
        self.assertEqual(restored.extensions, ["pdf", "docx"])

    def test_legacy_directory_dict_without_new_fields(self):
        directory = TargetProfileDirectory.from_dict({"path": "D:/x", "description": "旧数据"})
        assert directory is not None
        self.assertEqual(directory.extensions, [])
        self.assertEqual(directory.name_patterns, [])


class GenerateProfileRuleDraftsServiceTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_rule_draft_service")
        if self.root.exists():
            shutil.rmtree(self.root)
        self.root.mkdir()
        self.store = SessionStore(self.root / "sessions")
        self.service = OrganizerSessionService(self.store)
        self.docs_dir = self.root / "docs"
        self.docs_dir.mkdir()
        (self.docs_dir / "manual.pdf").write_text("m", encoding="utf-8")

    def tearDown(self):
        if self.root.exists():
            shutil.rmtree(self.root)

    def test_generate_rule_drafts_for_profile(self):
        profile = self.service.create_target_profile(
            "常用目录",
            [{"path": str(self.docs_dir), "label": "文档", "description": ""}],
        )
        client = _fake_client(
            json.dumps(
                {
                    "drafts": [
                        {
                            "path": str(self.docs_dir),
                            "draft_description": "PDF 技术手册",
                            "basis": "现有 1 个 PDF",
                        }
                    ]
                }
            )
        )

        result = self.service.generate_target_profile_rule_drafts(
            profile["profile_id"], client=client, model="test-model"
        )

        self.assertEqual(result["profile_id"], profile["profile_id"])
        item = result["items"][0]
        self.assertEqual(item["draft_description"], "PDF 技术手册")
        self.assertEqual(item["basis"], "现有 1 个 PDF")
        self.assertEqual(item["total_entries"], 1)
        self.assertTrue(item["readable"])

    def test_generate_rule_drafts_unknown_profile(self):
        with self.assertRaises(FileNotFoundError):
            self.service.generate_target_profile_rule_drafts("missing", client=_fake_client("{}"))
