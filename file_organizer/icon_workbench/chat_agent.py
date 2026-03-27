from __future__ import annotations

from typing import Any

from file_organizer.icon_workbench.models import IconTemplate, IconWorkbenchSession
from file_organizer.icon_workbench.prompts import (
    ICON_CHAT_AGENT_SYSTEM_PROMPT,
    build_icon_chat_context,
)


class IconWorkbenchChatAgent:
    def __init__(self, text_client):
        self.text_client = text_client

    def process_message(
        self,
        config,
        session: IconWorkbenchSession,
        user_message: str,
        templates: list[IconTemplate],
        *,
        selected_folder_ids: list[str] | None = None,
        active_folder_id: str | None = None,
    ) -> dict[str, Any]:
        context_text = build_icon_chat_context(
            self._build_folder_lines(session, selected_folder_ids or [], active_folder_id),
            self._build_template_lines(templates),
        )
        payload = self.text_client.complete_json(
            config.text_model,
            ICON_CHAT_AGENT_SYSTEM_PROMPT,
            f"{context_text}\n\n用户消息：{user_message.strip()}",
            temperature=0.25,
        )
        response = str(payload.get("response", "") or "").strip() or "我已经根据当前图标工坊状态整理出下一步建议。"
        actions = payload.get("actions")
        normalized_actions = []
        if isinstance(actions, list):
            for item in actions:
                normalized = self._normalize_action(item)
                if normalized:
                    normalized_actions.append(normalized)
        return {
            "response": response,
            "actions": normalized_actions,
        }

    def _build_folder_lines(
        self,
        session: IconWorkbenchSession,
        selected_folder_ids: list[str],
        active_folder_id: str | None,
    ) -> list[str]:
        selected = set(selected_folder_ids)
        lines: list[str] = []
        for folder in session.folders:
            current_version = next(
                (version for version in folder.versions if version.version_id == folder.current_version_id),
                None,
            )
            flags: list[str] = []
            if folder.folder_id in selected:
                flags.append("selected")
            if active_folder_id and folder.folder_id == active_folder_id:
                flags.append("active")
            version_desc = "none"
            if current_version:
                version_desc = f"{current_version.version_id}:{current_version.status}:v{current_version.version_number}"
            analysis_summary = folder.analysis.summary if folder.analysis else "未分析"
            lines.append(
                (
                    f"- folder_id={folder.folder_id} "
                    f"name={folder.folder_name} "
                    f"path={folder.folder_path} "
                    f"flags={','.join(flags) or 'none'} "
                    f"analysis={folder.analysis_status} "
                    f"current_version={version_desc} "
                    f"versions={len(folder.versions)} "
                    f"prompt={folder.current_prompt or '(empty)'} "
                    f"summary={analysis_summary}"
                )
            )
        return lines

    def _build_template_lines(self, templates: list[IconTemplate]) -> list[str]:
        return [
            f"- template_id={template.template_id} name={template.name} builtin={str(template.is_builtin).lower()} description={template.description}"
            for template in templates
        ]

    def _normalize_action(self, payload: Any) -> dict[str, Any] | None:
        if not isinstance(payload, dict):
            return None
        action_type = str(payload.get("type", "") or "").strip()
        if not action_type:
            return None
        normalized: dict[str, Any] = {
            "type": action_type,
            "scope": str(payload.get("scope", "") or "").strip(),
            "folder_ids": [str(item) for item in payload.get("folder_ids", []) if str(item).strip()],
        }
        for key in ("template_id", "folder_id", "prompt", "version_id", "version_scope"):
            value = payload.get(key)
            if value is None:
                continue
            normalized[key] = str(value).strip()
        return normalized
