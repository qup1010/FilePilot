from __future__ import annotations

import json
import os
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

from file_pilot.icon_workbench.config import IconWorkbenchConfigStore
from file_pilot.icon_workbench.models import IconTemplate, IconWorkbenchSession
from file_pilot.icon_workbench.templates import builtin_templates
from file_pilot.shared.settings_service import SettingsService

TEMPLATES_SCHEMA_VERSION = 1


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(f"{path.suffix}.{uuid.uuid4().hex}.tmp")

    try:
        temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

        max_retries = 5
        for attempt in range(max_retries):
            try:
                if path.exists():
                    os.replace(temp_path, path)
                else:
                    os.rename(temp_path, path)
                return
            except PermissionError:
                if attempt == max_retries - 1:
                    raise
                time.sleep(0.05 * (attempt + 1))
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass


class IconWorkbenchStore:
    def __init__(self, root: Path, settings_service: SettingsService | None = None):
        self.root = root
        self.sessions_dir = self.root / "sessions"
        self.previews_dir = self.root / "previews"
        self.templates_path = self.root / "templates.json"
        self.config_store = IconWorkbenchConfigStore(self.root / "config.json", settings_service=settings_service)
        self.sessions_dir.mkdir(parents=True, exist_ok=True)
        self.previews_dir.mkdir(parents=True, exist_ok=True)

    def session_path(self, session_id: str) -> Path:
        return self.sessions_dir / f"{session_id}.json"

    def load_session(self, session_id: str) -> IconWorkbenchSession:
        path = self.session_path(session_id)
        if not path.exists():
            raise FileNotFoundError(session_id)
        return IconWorkbenchSession.from_dict(json.loads(path.read_text(encoding="utf-8")))

    def list_sessions(self) -> list[IconWorkbenchSession]:
        sessions: list[IconWorkbenchSession] = []
        for path in self.sessions_dir.glob("*.json"):
            try:
                session = IconWorkbenchSession.from_dict(json.loads(path.read_text(encoding="utf-8")))
            except (OSError, json.JSONDecodeError, TypeError, ValueError):
                continue
            if session.session_id:
                sessions.append(session)
        return sorted(sessions, key=lambda session: session.updated_at or session.created_at, reverse=True)

    def save_session(self, session: IconWorkbenchSession) -> IconWorkbenchSession:
        path = self.session_path(session.session_id)
        _atomic_write_json(path, session.to_dict())
        return session

    def delete_session(self, session_id: str) -> bool:
        path = self.session_path(session_id)
        existed = path.exists()
        if existed:
            path.unlink()
        self.remove_session_assets(session_id)
        return existed

    def preview_directory(self, session_id: str, folder_id: str) -> Path:
        path = self.previews_dir / session_id / folder_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def remove_session_assets(self, session_id: str) -> None:
        preview_dir = self.previews_dir / session_id
        if preview_dir.exists():
            shutil.rmtree(preview_dir)

    def remove_folder_assets(self, session_id: str, folder_id: str) -> None:
        folder_dir = self.previews_dir / session_id / folder_id
        if folder_dir.exists():
            shutil.rmtree(folder_dir)

    def load_templates(self) -> list[IconTemplate]:
        if not self.templates_path.exists():
            self.save_user_templates([])
            return builtin_templates()

        payload = self._load_templates_payload()
        users = [IconTemplate.from_dict(item) for item in payload.get("user_templates", [])]
        for user_template in users:
            user_template.is_builtin = False
        return [*builtin_templates(), *users]

    def save_user_templates(self, templates: list[IconTemplate]) -> None:
        data = {
            "schema_version": TEMPLATES_SCHEMA_VERSION,
            "user_templates": [
                {
                    **template.to_dict(),
                    "is_builtin": False,
                }
                for template in templates
            ]
        }
        _atomic_write_json(self.templates_path, data)

    def _load_templates_payload(self) -> dict[str, Any]:
        payload = json.loads(self.templates_path.read_text(encoding="utf-8"))
        if isinstance(payload, list):
            return {
                "schema_version": TEMPLATES_SCHEMA_VERSION,
                "user_templates": payload,
            }

        if isinstance(payload, dict):
            return {
                "schema_version": int(payload.get("schema_version", TEMPLATES_SCHEMA_VERSION) or TEMPLATES_SCHEMA_VERSION),
                "user_templates": list(payload.get("user_templates", [])),
            }

        return {
            "schema_version": TEMPLATES_SCHEMA_VERSION,
            "user_templates": [],
        }
