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
        self.assertNotIn("extra_body", call_kwargs)

    def test_generate_rule_drafts_disables_deepseek_thinking(self):
        profiles = [
            rule_advisor.DirectoryContentProfile(path="D:/known", label="文档", total_entries=1),
        ]
        client = _fake_client(
            json.dumps({"drafts": [{"path": "D:/known", "draft_description": "文档", "basis": "样本"}]})
        )
        client.base_url = "https://api.deepseek.com/v1"

        rule_advisor.generate_rule_drafts(profiles, client=client, model="deepseek-v4-flash")

        call_kwargs = client.chat.completions.create.call_args.kwargs
        self.assertEqual(call_kwargs["extra_body"], {"thinking": {"type": "disabled"}})

    def test_build_rule_draft_completion_kwargs_detects_deepseek_by_model_name(self):
        kwargs = rule_advisor.build_rule_draft_completion_kwargs(
            model="deepseek-v4-pro",
            messages=[{"role": "user", "content": "x"}],
            base_url="https://proxy.example/v1",
        )
        self.assertEqual(kwargs["extra_body"], {"thinking": {"type": "disabled"}})

    def test_classify_rule_draft_error_thinking_tool_choice(self):
        code, message = rule_advisor.classify_rule_draft_error(
            RuntimeError("Error code: 400 - Thinking mode does not support this tool_choice")
        )
        self.assertEqual(code, "RULE_DRAFTS_THINKING_TOOL_UNSUPPORTED")
        self.assertIn("思考模式", message)


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

    def test_generate_rule_drafts_single_path(self):
        other = self.root / "images"
        other.mkdir()
        (other / "a.png").write_text("x", encoding="utf-8")
        profile = self.service.create_target_profile(
            "常用目录",
            [
                {"path": str(self.docs_dir), "label": "文档", "description": ""},
                {"path": str(other), "label": "图片", "description": ""},
            ],
        )
        client = _fake_client(
            json.dumps(
                {
                    "drafts": [
                        {
                            "path": str(self.docs_dir),
                            "draft_description": "仅文档",
                            "basis": "单目录",
                        }
                    ]
                }
            )
        )

        result = self.service.generate_target_profile_rule_drafts(
            profile["profile_id"],
            paths=[str(self.docs_dir)],
            client=client,
            model="test-model",
        )

        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(result["items"][0]["path"], str(self.docs_dir))
        self.assertEqual(result["items"][0]["draft_description"], "仅文档")

    def test_generate_rule_drafts_unknown_path(self):
        profile = self.service.create_target_profile(
            "常用目录",
            [{"path": str(self.docs_dir), "label": "文档", "description": ""}],
        )
        with self.assertRaises(ValueError) as ctx:
            self.service.generate_target_profile_rule_drafts(
                profile["profile_id"],
                paths=["D:/not-in-profile"],
                client=_fake_client("{}"),
            )
        self.assertEqual(str(ctx.exception), "RULE_DRAFTS_PATHS_NOT_IN_PROFILE")

    def test_generate_rule_drafts_unknown_profile(self):
        with self.assertRaises(FileNotFoundError):
            self.service.generate_target_profile_rule_drafts("missing", client=_fake_client("{}"))


class GenerateRulesFromCompletedSessionTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("test_temp_session_rule_drafts")
        if self.root.exists():
            shutil.rmtree(self.root)
        self.root.mkdir()
        self.target_dir = self.root / "Inbox"
        self.target_dir.mkdir()
        self.store = SessionStore(self.root / "sessions")
        self.service = OrganizerSessionService(self.store)

    def tearDown(self):
        if self.root.exists():
            shutil.rmtree(self.root)

    def test_generates_drafts_from_journal_target_dirs(self):
        from file_pilot.execution.models import ExecutionJournal, ExecutionJournalItem
        from file_pilot.execution.service import save_execution_journal

        docs = self.target_dir / "Docs"
        docs.mkdir()
        (docs / "manual.pdf").write_text("m", encoding="utf-8")

        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        journal = ExecutionJournal(
            execution_id="exec-rules-1",
            target_dir=str(self.target_dir.resolve()),
            created_at="2026-07-26T00:00:00+00:00",
            status="completed",
            items=[
                ExecutionJournalItem(
                    action_type="MOVE",
                    status="success",
                    message="移动成功",
                    source_before=str((self.target_dir / "manual.pdf").resolve()),
                    target_after=str((docs / "manual.pdf").resolve()),
                ),
                ExecutionJournalItem(
                    action_type="MOVE",
                    status="skipped",
                    message="目标已有同名文件，跳过并留在原地",
                    source_before=str((self.target_dir / "dup.pdf").resolve()),
                    target_after=str((docs / "dup.pdf").resolve()),
                ),
            ],
        )
        save_execution_journal(journal)
        try:
            session.stage = "completed"
            session.last_journal_id = journal.execution_id
            self.store.save(session)

            docs_path = str(docs.resolve())
            client = _fake_client(
                json.dumps(
                    {
                        "drafts": [
                            {"path": docs_path, "draft_description": "PDF 手册", "basis": "现有 1 个 PDF"}
                        ]
                    }
                )
            )

            result = self.service.generate_rules_from_completed_session(session.session_id, client=client, model="m")

            self.assertEqual(result["journal_id"], "exec-rules-1")
            self.assertEqual(len(result["items"]), 1)
            self.assertEqual(result["items"][0]["path"], docs_path)
            self.assertEqual(result["items"][0]["draft_description"], "PDF 手册")
            self.assertIn("inbox", result["suggested_profile_name"].lower())
        finally:
            from file_pilot.execution.service import delete_execution_journal

            delete_execution_journal(journal.execution_id)

    def test_requires_completed_stage(self):
        created = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session = created.session
        assert session is not None
        with self.assertRaises(RuntimeError):
            self.service.generate_rules_from_completed_session(session.session_id, client=_fake_client("{}"))
