from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class ModelConfig:
    base_url: str = ""
    api_key: str = ""
    model: str = ""

    @classmethod
    def from_dict(cls, payload: dict[str, Any] | None) -> "ModelConfig":
        data = payload or {}
        return cls(
            base_url=str(data.get("base_url", "") or "").strip(),
            api_key=str(data.get("api_key", "") or "").strip(),
            model=str(data.get("model", "") or "").strip(),
        )

    def to_dict(self) -> dict[str, str]:
        return {
            "base_url": self.base_url,
            "api_key": self.api_key,
            "model": self.model,
        }

    def is_configured(self) -> bool:
        return bool(self.base_url and self.model and self.api_key)


@dataclass
class IconWorkbenchConfig:
    text_model: ModelConfig = field(default_factory=ModelConfig)
    image_model: ModelConfig = field(default_factory=ModelConfig)
    image_size: str = "1024x1024"
    concurrency_limit: int = 1
    save_mode: str = "centralized"  # "in_folder" | "centralized"

    @classmethod
    def from_dict(cls, payload: dict[str, Any] | None) -> "IconWorkbenchConfig":
        data = payload or {}
        concurrency_limit = data.get("concurrency_limit", 1)
        try:
            parsed_limit = int(concurrency_limit)
        except (TypeError, ValueError):
            parsed_limit = 1

        return cls(
            text_model=ModelConfig.from_dict(data.get("text_model")),
            image_model=ModelConfig.from_dict(data.get("image_model")),
            image_size=str(data.get("image_size", "1024x1024") or "1024x1024").strip() or "1024x1024",
            concurrency_limit=max(1, min(parsed_limit, 6)),
            save_mode=str(data.get("save_mode", "centralized") or "centralized").strip().lower() or "centralized",
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "text_model": self.text_model.to_dict(),
            "image_model": self.image_model.to_dict(),
            "image_size": self.image_size,
            "concurrency_limit": self.concurrency_limit,
            "save_mode": self.save_mode,
        }


@dataclass
class IconTemplate:
    template_id: str
    name: str
    description: str
    prompt_template: str
    cover_image: str | None = None
    is_builtin: bool = False
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "IconTemplate":
        return cls(
            template_id=str(payload.get("template_id", "") or ""),
            name=str(payload.get("name", "") or ""),
            description=str(payload.get("description", "") or ""),
            prompt_template=str(payload.get("prompt_template", "") or ""),
            cover_image=payload.get("cover_image"),
            is_builtin=bool(payload.get("is_builtin", False)),
            created_at=str(payload.get("created_at", "") or utc_now_iso()),
            updated_at=str(payload.get("updated_at", "") or utc_now_iso()),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "template_id": self.template_id,
            "name": self.name,
            "description": self.description,
            "prompt_template": self.prompt_template,
            "cover_image": self.cover_image,
            "is_builtin": self.is_builtin,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


@dataclass
class IconWorkbenchToolResult:
    tool_name: str
    success: bool
    message: str
    payload: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "IconWorkbenchToolResult":
        return cls(
            tool_name=str(payload.get("tool_name", "") or ""),
            success=bool(payload.get("success", False)),
            message=str(payload.get("message", "") or ""),
            payload=dict(payload.get("payload", {}) or {}),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "tool_name": self.tool_name,
            "success": self.success,
            "message": self.message,
            "payload": self.payload,
        }


@dataclass
class IconWorkbenchPendingAction:
    action_id: str
    action_type: str
    title: str
    description: str
    requires_confirmation: bool = True
    requires_client: bool = False
    payload: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=utc_now_iso)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "IconWorkbenchPendingAction":
        return cls(
            action_id=str(payload.get("action_id", "") or ""),
            action_type=str(payload.get("action_type", "") or ""),
            title=str(payload.get("title", "") or ""),
            description=str(payload.get("description", "") or ""),
            requires_confirmation=bool(payload.get("requires_confirmation", True)),
            requires_client=bool(payload.get("requires_client", False)),
            payload=dict(payload.get("payload", {}) or {}),
            created_at=str(payload.get("created_at", "") or utc_now_iso()),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "action_id": self.action_id,
            "action_type": self.action_type,
            "title": self.title,
            "description": self.description,
            "requires_confirmation": self.requires_confirmation,
            "requires_client": self.requires_client,
            "payload": self.payload,
            "created_at": self.created_at,
        }


@dataclass
class IconWorkbenchChatMessage:
    message_id: str
    role: str
    content: str
    tool_results: list[IconWorkbenchToolResult] = field(default_factory=list)
    action_ids: list[str] = field(default_factory=list)
    created_at: str = field(default_factory=utc_now_iso)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "IconWorkbenchChatMessage":
        return cls(
            message_id=str(payload.get("message_id", "") or ""),
            role=str(payload.get("role", "") or "assistant"),
            content=str(payload.get("content", "") or ""),
            tool_results=[IconWorkbenchToolResult.from_dict(item) for item in payload.get("tool_results", [])],
            action_ids=[str(item) for item in payload.get("action_ids", [])],
            created_at=str(payload.get("created_at", "") or utc_now_iso()),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "message_id": self.message_id,
            "role": self.role,
            "content": self.content,
            "tool_results": [item.to_dict() for item in self.tool_results],
            "action_ids": self.action_ids,
            "created_at": self.created_at,
        }


@dataclass
class IconAnalysisResult:
    category: str
    visual_subject: str
    summary: str
    suggested_prompt: str
    analyzed_at: str = field(default_factory=utc_now_iso)

    @classmethod
    def from_dict(cls, payload: dict[str, Any] | None) -> "IconAnalysisResult | None":
        if not payload:
            return None
        return cls(
            category=str(payload.get("category", "") or "").strip(),
            visual_subject=str(payload.get("visual_subject", "") or "").strip(),
            summary=str(payload.get("summary", "") or "").strip(),
            suggested_prompt=str(payload.get("suggested_prompt", "") or "").strip(),
            analyzed_at=str(payload.get("analyzed_at", "") or utc_now_iso()),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "category": self.category,
            "visual_subject": self.visual_subject,
            "summary": self.summary,
            "suggested_prompt": self.suggested_prompt,
            "analyzed_at": self.analyzed_at,
        }


@dataclass
class IconPreviewVersion:
    version_id: str
    version_number: int
    prompt: str
    image_path: str
    status: str = "ready"
    error_message: str | None = None
    created_at: str = field(default_factory=utc_now_iso)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "IconPreviewVersion":
        return cls(
            version_id=str(payload.get("version_id", "") or ""),
            version_number=int(payload.get("version_number", 1) or 1),
            prompt=str(payload.get("prompt", "") or ""),
            image_path=str(payload.get("image_path", "") or ""),
            status=str(payload.get("status", "ready") or "ready"),
            error_message=payload.get("error_message"),
            created_at=str(payload.get("created_at", "") or utc_now_iso()),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "version_id": self.version_id,
            "version_number": self.version_number,
            "prompt": self.prompt,
            "image_path": self.image_path,
            "status": self.status,
            "error_message": self.error_message,
            "created_at": self.created_at,
        }


@dataclass
class FolderIconCandidate:
    folder_id: str
    folder_path: str
    folder_name: str
    analysis_status: str = "idle"
    analysis: IconAnalysisResult | None = None
    current_prompt: str = ""
    prompt_customized: bool = False
    versions: list[IconPreviewVersion] = field(default_factory=list)
    current_version_id: str | None = None
    last_error: str | None = None
    updated_at: str = field(default_factory=utc_now_iso)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "FolderIconCandidate":
        return cls(
            folder_id=str(payload.get("folder_id", "") or ""),
            folder_path=str(payload.get("folder_path", "") or ""),
            folder_name=str(payload.get("folder_name", "") or ""),
            analysis_status=str(payload.get("analysis_status", "idle") or "idle"),
            analysis=IconAnalysisResult.from_dict(payload.get("analysis")),
            current_prompt=str(payload.get("current_prompt", "") or ""),
            prompt_customized=bool(payload.get("prompt_customized", False)),
            versions=[IconPreviewVersion.from_dict(item) for item in payload.get("versions", [])],
            current_version_id=payload.get("current_version_id"),
            last_error=payload.get("last_error"),
            updated_at=str(payload.get("updated_at", "") or utc_now_iso()),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "folder_id": self.folder_id,
            "folder_path": self.folder_path,
            "folder_name": self.folder_name,
            "analysis_status": self.analysis_status,
            "analysis": self.analysis.to_dict() if self.analysis else None,
            "current_prompt": self.current_prompt,
            "prompt_customized": self.prompt_customized,
            "versions": [item.to_dict() for item in self.versions],
            "current_version_id": self.current_version_id,
            "last_error": self.last_error,
            "updated_at": self.updated_at,
        }


@dataclass
class IconWorkbenchSession:
    session_id: str
    target_paths: list[str] = field(default_factory=list)
    folders: list[FolderIconCandidate] = field(default_factory=list)
    messages: list[IconWorkbenchChatMessage] = field(default_factory=list)
    pending_actions: list[IconWorkbenchPendingAction] = field(default_factory=list)
    chat_updated_at: str = field(default_factory=utc_now_iso)
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "IconWorkbenchSession":
        return cls(
            session_id=str(payload.get("session_id", "") or ""),
            target_paths=[str(item or "").strip() for item in payload.get("target_paths", []) if str(item or "").strip()],
            folders=[FolderIconCandidate.from_dict(item) for item in payload.get("folders", [])],
            messages=[IconWorkbenchChatMessage.from_dict(item) for item in payload.get("messages", [])],
            pending_actions=[IconWorkbenchPendingAction.from_dict(item) for item in payload.get("pending_actions", [])],
            chat_updated_at=str(payload.get("chat_updated_at", "") or utc_now_iso()),
            created_at=str(payload.get("created_at", "") or utc_now_iso()),
            updated_at=str(payload.get("updated_at", "") or utc_now_iso()),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "target_paths": list(self.target_paths),
            "folders": [item.to_dict() for item in self.folders],
            "messages": [item.to_dict() for item in self.messages],
            "pending_actions": [item.to_dict() for item in self.pending_actions],
            "chat_updated_at": self.chat_updated_at,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
