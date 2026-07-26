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
        return {
            "journal_id": journal.execution_id,
            "execution_id": journal.execution_id,
            "target_dir": journal.target_dir,
            "status": journal.status,
            "created_at": journal.created_at,
            "item_count": len(journal.items),
            "success_count": sum(1 for item in journal.items if item.status == "success"),
            "failure_count": sum(1 for item in journal.items if item.status == "failed"),
            "rollback_attempt_count": len(journal.rollback_attempts),
            "restore_items": restore_items,
            "items": [
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
            ],
        }
