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
    analysis_concurrency_limit: int = 2
    image_concurrency_limit: int = 1
    save_mode: str = "centralized"  # "in_folder" | "centralized"

    @classmethod
    def from_dict(cls, payload: dict[str, Any] | None) -> "IconWorkbenchConfig":
        data = payload or {}
        legacy_limit = data.get("concurrency_limit")
        analysis_limit = data.get("analysis_concurrency_limit", legacy_limit)
        image_limit = data.get("image_concurrency_limit", legacy_limit)
        try:
            parsed_analysis_limit = int(analysis_limit)
        except (TypeError, ValueError):
            parsed_analysis_limit = 2
        try:
            parsed_image_limit = int(image_limit)
        except (TypeError, ValueError):
            parsed_image_limit = 1

        return cls(
            text_model=ModelConfig.from_dict(data.get("text_model")),
            image_model=ModelConfig.from_dict(data.get("image_model")),
            image_size=str(data.get("image_size", "1024x1024") or "1024x1024").strip() or "1024x1024",
            analysis_concurrency_limit=max(1, min(parsed_analysis_limit, 6)),
            image_concurrency_limit=max(1, min(parsed_image_limit, 6)),
            save_mode=str(data.get("save_mode", "centralized") or "centralized").strip().lower() or "centralized",
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "text_model": self.text_model.to_dict(),
            "image_model": self.image_model.to_dict(),
            "image_size": self.image_size,
            "analysis_concurrency_limit": self.analysis_concurrency_limit,
            "image_concurrency_limit": self.image_concurrency_limit,
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
class IconWorkbenchClientActionSummary:
    action_type: str
    success_count: int
    failed_count: int
    skipped_count: int
    message: str
    results: list[dict[str, Any]] = field(default_factory=list)
    updated_at: str = field(default_factory=utc_now_iso)

    @classmethod
    def from_dict(cls, payload: dict[str, Any] | None) -> "IconWorkbenchClientActionSummary | None":
        if not payload:
            return None
        summary = dict(payload.get("summary", {}) or {})
        return cls(
            action_type=str(payload.get("action_type", "") or ""),
            success_count=int(summary.get("success_count", 0) or 0),
            failed_count=int(summary.get("failed_count", 0) or 0),
            skipped_count=int(summary.get("skipped_count", 0) or 0),
            message=str(summary.get("message", "") or ""),
            results=[dict(item) for item in payload.get("results", [])],
            updated_at=str(payload.get("updated_at", "") or utc_now_iso()),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "action_type": self.action_type,
            "summary": {
                "success_count": self.success_count,
                "failed_count": self.failed_count,
                "skipped_count": self.skipped_count,
                "message": self.message,
            },
            "results": list(self.results),
            "updated_at": self.updated_at,
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
    applied_version_id: str | None = None
    applied_at: str | None = None
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
            applied_version_id=payload.get("applied_version_id"),
            applied_at=payload.get("applied_at"),
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
            "applied_version_id": self.applied_version_id,
            "applied_at": self.applied_at,
            "last_error": self.last_error,
            "updated_at": self.updated_at,
        }


@dataclass
class IconWorkbenchSession:
    session_id: str
    target_paths: list[str] = field(default_factory=list)
    folders: list[FolderIconCandidate] = field(default_factory=list)
    last_client_action: IconWorkbenchClientActionSummary | None = None
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> "IconWorkbenchSession":
        return cls(
            session_id=str(payload.get("session_id", "") or ""),
            target_paths=[str(item or "").strip() for item in payload.get("target_paths", []) if str(item or "").strip()],
            folders=[FolderIconCandidate.from_dict(item) for item in payload.get("folders", [])],
            last_client_action=IconWorkbenchClientActionSummary.from_dict(payload.get("last_client_action")),
            created_at=str(payload.get("created_at", "") or utc_now_iso()),
            updated_at=str(payload.get("updated_at", "") or utc_now_iso()),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "target_paths": list(self.target_paths),
            "folders": [item.to_dict() for item in self.folders],
            "last_client_action": self.last_client_action.to_dict() if self.last_client_action else None,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
