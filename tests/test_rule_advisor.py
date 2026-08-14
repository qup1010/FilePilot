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


class DetectNestedPairsTests(unittest.TestCase):
    """detect_nested_pairs 的边界测试。"""

    def test_parallel_paths_no_pairs(self):
        pairs = rule_advisor.detect_nested_pairs(["D:/A", "D:/B"])
        self.assertEqual(pairs, [])

    def test_direct_parent_child(self):
        # 创建真实目录以让 resolve() 正常工作
        import os
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            parent = os.path.join(tmp, "parent")
            child = os.path.join(tmp, "parent", "child")
            os.makedirs(child)
            pairs = rule_advisor.detect_nested_pairs([parent, child])
            self.assertEqual(len(pairs), 1)
            # 结果中 parent 在左，child 在右
            self.assertIn((parent, child), pairs)

    def test_name_prefix_not_confused_as_parent(self):
        """D:/Pictures 不应该是 D:/Pictures2 的父目录。"""
        import os
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            p1 = os.path.join(tmp, "Pictures")
            p2 = os.path.join(tmp, "Pictures2")
            os.makedirs(p1)
            os.makedirs(p2)
            pairs = rule_advisor.detect_nested_pairs([p1, p2])
            self.assertEqual(pairs, [])

    def test_deep_nesting(self):
        """三层嵌套：A ⊃ A/B ⊃ A/B/C，应返回 3 对。"""
        import os
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            a = os.path.join(tmp, "A")
            b = os.path.join(tmp, "A", "B")
            c = os.path.join(tmp, "A", "B", "C")
            os.makedirs(c)
            pairs = rule_advisor.detect_nested_pairs([a, b, c])
            # 应包含 (a,b), (a,c), (b,c)
            self.assertEqual(len(pairs), 3)
            self.assertIn((a, b), pairs)
            self.assertIn((a, c), pairs)
            self.assertIn((b, c), pairs)

    def test_empty_list(self):
        self.assertEqual(rule_advisor.detect_nested_pairs([]), [])

    def test_single_path(self):
        self.assertEqual(rule_advisor.detect_nested_pairs(["D:/only"]), [])


class ContextEntryRelationTests(unittest.TestCase):
    """ContextEntry relation 字段与 to_context_line 渲染。"""

    def test_relation_prefix_rendered(self):
        entry = rule_advisor.ContextEntry(
            path="D:/Pictures",
            label="图库",
            description="存放图片",
            relation="[父目录]",
        )
        line = entry.to_context_line()
        self.assertTrue(line.startswith("- [父目录]"))
        self.assertIn("D:/Pictures", line)

    def test_no_relation_no_extra_space(self):
        entry = rule_advisor.ContextEntry(path="D:/Docs", description="文档")
        line = entry.to_context_line()
        self.assertTrue(line.startswith("- D:/Docs"))

    def test_empty_description_renders_placeholder(self):
        entry = rule_advisor.ContextEntry(path="D:/Empty", relation="[子目录]")
        line = entry.to_context_line()
        self.assertIn("暂无规则", line)
        self.assertIn("[子目录]", line)


class BuildRuleDraftPromptTopologyTests(unittest.TestCase):
    """build_rule_draft_prompt 的拓扑注入行为。"""

    def _make_profile(self, path: str) -> rule_advisor.DirectoryContentProfile:
        return rule_advisor.DirectoryContentProfile(path=path, label="", total_entries=0)

    def test_no_nesting_no_topology_section(self):
        import os
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            a = os.path.join(tmp, "A")
            b = os.path.join(tmp, "B")
            os.makedirs(a)
            os.makedirs(b)
            profiles = [self._make_profile(a), self._make_profile(b)]
            messages = rule_advisor.build_rule_draft_prompt(profiles)
            content = messages[0]["content"]
            self.assertNotIn("层级关系", content)
            self.assertNotIn("最窄匹配", content)

    def test_nested_profiles_inject_topology(self):
        import os
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            parent = os.path.join(tmp, "Parent")
            child = os.path.join(tmp, "Parent", "Child")
            os.makedirs(child)
            profiles = [self._make_profile(parent), self._make_profile(child)]
            messages = rule_advisor.build_rule_draft_prompt(profiles)
            content = messages[0]["content"]
            self.assertIn("层级关系", content)
            self.assertIn("最窄匹配", content)
            self.assertIn("⊃", content)

    def test_nested_context_entry_inject_topology(self):
        """profiles 里没嵌套，但 profile 与 context_entry 之间有嵌套关系时，也应注入拓扑。"""
        import os
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            parent = os.path.join(tmp, "Parent")
            child = os.path.join(tmp, "Parent", "Child")
            os.makedirs(child)
            profiles = [self._make_profile(child)]
            context_entries = [
                rule_advisor.ContextEntry(path=parent, label="", description="通用文件", relation="[父目录]")
            ]
            messages = rule_advisor.build_rule_draft_prompt(profiles, context_entries=context_entries)
            content = messages[0]["content"]
            self.assertIn("层级关系", content)
            self.assertIn("最窄匹配", content)


class SinglePathContextCoverageTests(unittest.TestCase):
    """单目录分析时 context_entries 应覆盖所有非目标目录，包括 description 为空的嵌套目录。"""

    def setUp(self):
        import tempfile
        self._tmp = tempfile.mkdtemp()
        self.root = Path(self._tmp)
        self.store = SessionStore(self.root / "sessions")
        self.service = OrganizerSessionService(self.store)

    def tearDown(self):
        import shutil
        shutil.rmtree(self._tmp, ignore_errors=True)

    def _capture_context_entries(self, profile_id: str, target_path: str):
        """调用服务并捕获传入 generate_rule_drafts 的 context_entries。"""
        captured = {}

        def fake_generate(profiles, *, client=None, model=None, context_entries=None):
            captured["context_entries"] = context_entries or []
            path = profiles[0].path
            return [rule_advisor.RuleDraft(path=path, draft_description="x", basis="y")]

        with mock.patch.object(rule_advisor, "generate_rule_drafts", side_effect=fake_generate):
            self.service.generate_target_profile_rule_drafts(
                profile_id, paths=[target_path], client=mock.MagicMock(), model="m"
            )
        return captured["context_entries"]

    def test_empty_description_sibling_included_in_context(self):
        """description 为空的平行目录也应进入 context。"""
        docs = self.root / "Docs"
        images = self.root / "Images"
        docs.mkdir()
        images.mkdir()

        profile = self.service.create_target_profile(
            "测试",
            [
                {"path": str(docs), "label": "文档", "description": "PDF 手册"},
                {"path": str(images), "label": "图片", "description": ""},  # description 为空
            ],
        )
        entries = self._capture_context_entries(profile["profile_id"], str(docs))
        paths_in_context = [e.path for e in entries]
        self.assertIn(str(images), paths_in_context)

    def test_empty_description_parent_marked_as_parent(self):
        """父目录 description 为空，对子目录触发分析，父目录必须进入 context 且 relation=[父目录]。"""
        parent = self.root / "Pictures"
        child = self.root / "Pictures" / "Design"
        child.mkdir(parents=True)

        profile = self.service.create_target_profile(
            "嵌套测试",
            [
                {"path": str(parent), "label": "图库", "description": ""},   # description 为空
                {"path": str(child), "label": "设计稿", "description": ""},
            ],
        )
        entries = self._capture_context_entries(profile["profile_id"], str(child))
        parent_entries = [e for e in entries if e.path == str(parent)]
        self.assertEqual(len(parent_entries), 1)
        self.assertEqual(parent_entries[0].relation, "[父目录]")

    def test_empty_description_child_marked_as_child(self):
        """子目录 description 为空，对父目录触发分析，子目录必须进入 context 且 relation=[子目录]。"""
        parent = self.root / "Pictures"
        child = self.root / "Pictures" / "Design"
        child.mkdir(parents=True)

        profile = self.service.create_target_profile(
            "嵌套测试2",
            [
                {"path": str(parent), "label": "图库", "description": ""},
                {"path": str(child), "label": "设计稿", "description": ""},
            ],
        )
        entries = self._capture_context_entries(profile["profile_id"], str(parent))
        child_entries = [e for e in entries if e.path == str(child)]
        self.assertEqual(len(child_entries), 1)
        self.assertEqual(child_entries[0].relation, "[子目录]")

