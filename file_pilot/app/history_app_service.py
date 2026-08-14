import os
from pathlib import Path
from typing import TYPE_CHECKING

from file_pilot.app.session_constants import STAGE_ROLLING_BACK, is_locked_stage, is_stage_in
from file_pilot.execution import service as execution_service
from file_pilot.shared.review import REVIEW_SLOT_ID

if TYPE_CHECKING:
    from file_pilot.app.session_service import OrganizerSessionService


class HistoryAppService:
    def __init__(self, helpers: "OrganizerSessionService"):
        self.helpers = helpers

    def list_history(self) -> list[dict]:
        import json

        from file_pilot.shared import config

        history_map: dict[str, dict] = {}

        executions_dir = config.EXECUTION_LOG_DIR
        if executions_dir.exists():
            for path in executions_dir.glob("*.json"):
                try:
                    data = json.loads(path.read_text(encoding="utf-8"))
                    exec_id = data["execution_id"]
                    history_map[exec_id] = {
                        "execution_id": exec_id,
                        "target_dir": data["target_dir"],
                        "status": data["status"],
                        "created_at": data["created_at"],
                        "item_count": len(data.get("items", [])),
                        "failure_count": sum(1 for it in data.get("items", []) if it.get("status") == "failed"),
                        "is_session": False,
                    }
                except (json.JSONDecodeError, KeyError):
                    continue

        for session in self.helpers.store.list_sessions():
            self.helpers._recover_orphaned_locked_session(session)
            stage = session.stage
            if is_stage_in(stage, {"abandoned", "completed"}):
                continue

            history_map[session.session_id] = {
                "execution_id": session.session_id,
                "target_dir": session.target_dir,
                "status": stage,
                "created_at": session.updated_at or session.created_at,
                "item_count": int(self.helpers._plan_snapshot_payload(session.plan_snapshot).stats.get("move_count", 0) or 0),
                "failure_count": 0,
                "is_session": True,
            }

        history = list(history_map.values())
        history.sort(key=lambda x: str(x.get("created_at") or ""), reverse=True)
        return history

    def search_file_history(self, query: str, limit: int = 50) -> dict:
        """文件粒度检索：输入文件名片段 → 它现在在哪、哪次整理动的。

        一键整理最大的风险不是「移错」而是「找不到」，这个入口是安全论证的
        组成部分。当前实现全量扫描 journal 目录，几百次执行内无感；再往上
        需要倒排索引，字段已备齐。
        """
        import json

        from file_pilot.shared import config

        needle = str(query or "").strip().lower()
        result_limit = max(1, min(int(limit or 50), 200))
        if not needle:
            return {"query": query, "total": 0, "matches": []}

        def _norm(path_text: str | None) -> str:
            return os.path.normcase(str(path_text or "").replace("\\", "/")).rstrip("/")

        matches: list[dict] = []
        executions_dir = config.EXECUTION_LOG_DIR
        journal_paths = list(executions_dir.glob("*.json")) if executions_dir.exists() else []
        for path in journal_paths:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                execution_id = data["execution_id"]
            except (json.JSONDecodeError, KeyError, OSError):
                continue

            rolled_back_sources = {
                _norm(item.get("source"))
                for attempt in data.get("rollback_attempts", [])
                for item in attempt.get("results", [])
                if item.get("action_type") == "MOVE" and item.get("status") == "success"
            }

            for item in data.get("items", []):
                if item.get("action_type") != "MOVE":
                    continue
                source = str(item.get("source_before") or "")
                target = str(item.get("target_after") or "")
                display_name = str(item.get("display_name") or Path(source or target or "unknown").name)
                haystack = {display_name.lower(), Path(source).name.lower(), Path(target).name.lower()}
                if not any(needle in text for text in haystack if text):
                    continue

                item_status = str(item.get("status") or "")
                if item_status == "success":
                    if target and _norm(target) in rolled_back_sources:
                        current_path, status = source, "rolled_back"
                    else:
                        current_path, status = target, "success"
                else:
                    # skipped / failed / pending：文件没有离开原地（pending 需对账确认）
                    current_path, status = source, item_status or "unknown"

                matches.append(
                    {
                        "display_name": display_name,
                        "source_path": source or None,
                        "current_path": current_path or None,
                        "current_path_exists": bool(current_path) and Path(current_path).exists(),
                        "status": status,
                        "message": str(item.get("message") or ""),
                        "decision_basis": item.get("decision_basis"),
                        "execution_id": execution_id,
                        "moved_at": str(data.get("created_at") or ""),
                        "target_dir": str(data.get("target_dir") or ""),
                    }
                )

        matches.sort(key=lambda entry: entry["moved_at"], reverse=True)
        return {"query": query, "total": len(matches), "matches": matches[:result_limit]}

    def delete_history_entry(self, entry_id: str) -> dict:
        session = self.helpers.store.load(entry_id)
        if session is not None:
            self.helpers._recover_orphaned_locked_session(session)
            session = self.helpers.store.load(entry_id) or session
            if is_locked_stage(session.stage):
                raise RuntimeError("SESSION_LOCKED")
            deleted = self.helpers.store.delete(entry_id)
            if not deleted:
                raise FileNotFoundError(entry_id)
            return {"status": "deleted", "entry_id": entry_id, "entry_type": "session"}

        journal = execution_service.load_execution_journal(entry_id)
        if journal is not None:
            if self.helpers._is_locked_stage_active(entry_id, STAGE_ROLLING_BACK):
                raise RuntimeError("SESSION_LOCKED")
            deleted = execution_service.delete_execution_journal(entry_id)
            if not deleted:
                raise FileNotFoundError(entry_id)
            return {"status": "deleted", "entry_id": entry_id, "entry_type": "execution"}

        raise FileNotFoundError(entry_id)

    def get_journal_summary(self, session_id: str) -> dict:
        session = None
        journal_id = None
        try:
            session = self.helpers._load_or_raise(session_id)
            journal_id = session.last_journal_id or self.helpers._latest_execution_id(Path(session.target_dir))
        except (KeyError, FileNotFoundError):
            journal_id = session_id

        if not journal_id:
            raise FileNotFoundError("latest_execution")
        journal = execution_service.load_execution_journal(journal_id)
        if journal is None:
            raise FileNotFoundError(f"execution_journal_not_found: {journal_id}")

        if session is None:
            for s in self.helpers.store.list_sessions():
                if s.last_journal_id == journal_id or s.session_id == session_id:
                    session = s
                    break

        def _is_review_target(target_slot_id: str | None, target_path: str | None) -> bool:
            if str(target_slot_id or "").strip() == REVIEW_SLOT_ID:
                return True
            normalized_target = str(target_path or "").replace("\\", "/").strip().rstrip("/")
            if not normalized_target:
                return False
            return any(part.lower() == "review" for part in normalized_target.split("/") if part)

        def _target_kind(target_slot_id: str | None, target_path: str | None) -> str:
            return "review" if _is_review_target(target_slot_id, target_path) else "directory"

        restore_items = []
        if journal.rollback_attempts:
            latest_attempt = journal.rollback_attempts[-1]
            restore_items = [
                {
                    "action_type": item.get("action_type"),
                    "status": item.get("status"),
                    "source": item.get("source"),
                    "target": item.get("target"),
                    "display_name": str(item.get("display_name") or Path(item.get("source") or item.get("target") or "unknown").name),
                    "item_id": item.get("item_id"),
                    "source_ref_id": item.get("source_ref_id"),
                    "target_slot_id": item.get("target_slot_id"),
                    "target_kind": _target_kind(item.get("target_slot_id"), item.get("target")),
                    "is_review": _is_review_target(item.get("target_slot_id"), item.get("target")),
                }
                for item in latest_attempt.get("results", [])
                if item.get("action_type") == "MOVE"
            ]
        executed_items = [
            {
                "action_type": item.action_type,
                "status": item.status,
                "message": item.message,
                "source": item.source_before,
                "target": item.target_after or item.created_path,
                "display_name": str(
                    item.display_name
                    or (Path(item.source_before).name if item.source_before else (Path(item.created_path).name if item.created_path else "unknown"))
                ),
                "item_id": item.item_id,
                "source_ref_id": item.source_ref_id,
                "target_slot_id": item.target_slot_id,
                "target_kind": _target_kind(item.target_slot_id, item.target_after or item.created_path),
                "is_review": _is_review_target(item.target_slot_id, item.target_after or item.created_path),
            }
            for item in journal.items
        ]

        # 补全全量扫描范围中未被移动（未命中分类规则、留在原地）的项
        if session is not None:
            try:
                planner_items = self.helpers._session_planner_items(session)
            except Exception:
                planner_items = getattr(session, "planner_items", None) or []

            if planner_items:
                executed_sources = {
                    str(Path(item["source"]).resolve()).lower()
                    for item in executed_items
                    if item.get("source")
                }
                base_dir = Path(session.target_dir)
                for p_item in planner_items:
                    if p_item.get("entry_type") == "dir":
                        continue
                    relpath = p_item.get("source_relpath") or ""
                    if not relpath:
                        continue
                    full_path = (base_dir / relpath).resolve()
                    norm_key = str(full_path).lower()
                    if norm_key not in executed_sources:
                        executed_items.append(
                            {
                                "action_type": "MOVE",
                                "status": "skipped",
                                "message": "未命中任何目标分类规则，选择留在原地",
                                "source": str(full_path),
                                "target": str(full_path),
                                "display_name": str(p_item.get("display_name") or full_path.name),
                                "item_id": p_item.get("planner_id"),
                                "source_ref_id": None,
                                "target_slot_id": None,
                                "target_kind": "directory",
                                "is_review": False,
                            }
                        )

        return {
            "journal_id": journal.execution_id,
            "execution_id": journal.execution_id,
            "target_dir": journal.target_dir,
            "status": journal.status,
            "created_at": journal.created_at,
            "item_count": len(executed_items),
            "success_count": sum(1 for item in executed_items if item["status"] == "success"),
            "failure_count": sum(1 for item in executed_items if item["status"] == "failed"),
            "rollback_attempt_count": len(journal.rollback_attempts),
            "restore_items": restore_items,
            "items": executed_items,
        }
