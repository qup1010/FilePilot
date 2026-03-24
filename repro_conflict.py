import unittest
from pathlib import Path
import shutil
import json
from unittest import mock
from file_organizer.app.session_service import OrganizerSessionService
from file_organizer.app.session_store import SessionStore
from file_organizer.organize.models import PendingPlan, PlanMove

class TestUnresolvedConflictReproduction(unittest.TestCase):
    def setUp(self):
        self.root = Path("repro_conflict_test")
        if self.root.exists():
            shutil.rmtree(self.root, ignore_errors=True)
        self.target_dir = self.root / "Work"
        self.target_dir.mkdir(parents=True, exist_ok=True)
        (self.target_dir / "md").mkdir()
        
        self.store = SessionStore(self.root / "sessions")
        self.service = OrganizerSessionService(self.store)

    def tearDown(self):
        if self.root.exists():
            shutil.rmtree(self.root, ignore_errors=True)

    def test_repro_unresolved_conflict(self):
        # 1. Create session
        res = self.service.create_session(str(self.target_dir), resume_if_exists=False)
        session_id = res.session.session_id
        
        # 2. Mock state where AI has sent a choice request but mistakenly cleared unresolved_items in pending_plan
        session = self.service.store.load(session_id)
        session.stage = "planning"
        session.scan_lines = "md | 笔记 | 扫描生成的文件夹"
        # 典型的 AI 不一致：既提供了 UI 选择，又在计划里说它已分类（不在 unresolved_items 中）
        session.pending_plan = {
            "directories": ["Review"],
            "moves": [{"source": "md", "target": "Review/md"}],
            "unresolved_items": [], # 注意：这里是空的！导致了冲突
            "summary": "已分类 0 项，调整 1 项，仍剩 0 项待定"
        }
        session.messages = [
            {
                "role": "assistant",
                "content": "请帮我确认一顶",
                "blocks": [
                    {
                        "type": "unresolved_choices",
                        "request_id": "req_repro",
                        "summary": "请确认 md",
                        "status": "pending",
                        "items": [
                            {
                                "item_id": "md", 
                                "display_name": "md", 
                                "question": "放哪？", 
                                "suggested_folders": ["A", "B"]
                            }
                        ]
                    }
                ]
            }
        ]
        session.assistant_message = dict(session.messages[0])
        self.service.store.save(session)
        
        # 3. User tries to resolve
        # 当前后端会抛出 RuntimeError("UNRESOLVED_ITEM_CONFLICT")
        try:
            self.service.resolve_unresolved_choices(
                session_id, 
                "req_repro", 
                [{"item_id": "md", "selected_folder": "A", "note": ""}]
            )
        except RuntimeError as e:
            if str(e) == "UNRESOLVED_ITEM_CONFLICT":
                print("\n[SUCCESS] Successfully reproduced UNRESOLVED_ITEM_CONFLICT error.")
                return
            raise e
        
        self.fail("Expected UNRESOLVED_ITEM_CONFLICT but call succeeded.")

if __name__ == "__main__":
    unittest.main()
