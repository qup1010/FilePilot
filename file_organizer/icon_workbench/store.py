from __future__ import annotations

import json
import shutil
from pathlib import Path

from file_organizer.icon_workbench.config import IconWorkbenchConfigStore
from file_organizer.icon_workbench.models import IconTemplate, IconWorkbenchSession
from file_organizer.icon_workbench.templates import builtin_templates
from file_organizer.shared.settings_service import SettingsService


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

    def save_session(self, session: IconWorkbenchSession) -> IconWorkbenchSession:
        path = self.session_path(session.session_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(session.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
        return session

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

        payload = json.loads(self.templates_path.read_text(encoding="utf-8"))
        users = [IconTemplate.from_dict(item) for item in payload.get("user_templates", [])]
        for user_template in users:
            user_template.is_builtin = False
        return [*builtin_templates(), *users]

    def save_user_templates(self, templates: list[IconTemplate]) -> None:
        data = {
            "user_templates": [
                {
                    **template.to_dict(),
                    "is_builtin": False,
                }
                for template in templates
            ]
        }
        self.templates_path.parent.mkdir(parents=True, exist_ok=True)
        self.templates_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
