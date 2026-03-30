from __future__ import annotations

import json
import logging
import os
import re
from pathlib import Path
from queue import Empty
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from file_organizer.app.session_service import OrganizerSessionService
from file_organizer.app.session_store import SessionStore
from file_organizer.shared.logging_utils import setup_backend_logging

logger = logging.getLogger(__name__)


class CreateSessionPayload(BaseModel):
    target_dir: str
    resume_if_exists: bool = False
    strategy: dict[str, Any] | None = None


class MessagePayload(BaseModel):
    content: str


class UpdateItemPayload(BaseModel):
    item_id: str
    target_dir: str | None = None
    move_to_review: bool = False


class ConfirmPayload(BaseModel):
    confirm: bool = False


class OpenDirPayload(BaseModel):
    path: str | None = None


class PresetSwitchPayload(BaseModel):
    preset_type: str
    id: str


class AddPresetPayload(BaseModel):
    preset_type: str
    name: str
    copy_profile: bool = Field(default=True, alias="copy")
    config: dict[str, Any] | None = None


class ConfigSecretsPayload(BaseModel):
    keys: list[str] = Field(default_factory=list)


class LlmTestPayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    test_type: str = "text"


class IconWorkbenchCreatePayload(BaseModel):
    target_paths: list[str] = Field(default_factory=list)


class IconWorkbenchTargetUpdatePayload(BaseModel):
    target_paths: list[str] = Field(default_factory=list)
    mode: str = "append"


class IconWorkbenchFolderBatchPayload(BaseModel):
    folder_ids: list[str] = Field(default_factory=list)


class IconWorkbenchPromptPayload(BaseModel):
    prompt: str


class IconWorkbenchSelectVersionPayload(BaseModel):
    version_id: str


class IconWorkbenchConfigPresetSwitchPayload(BaseModel):
    id: str


class IconWorkbenchConfigPresetCreatePayload(BaseModel):
    name: str
    config: dict[str, Any] | None = None


class IconWorkbenchTemplatePayload(BaseModel):
    name: str
    description: str = ""
    prompt_template: str


class IconWorkbenchTemplateUpdatePayload(BaseModel):
    name: str | None = None
    description: str | None = None
    prompt_template: str | None = None


class IconWorkbenchApplyTemplatePayload(BaseModel):
    template_id: str
    folder_ids: list[str] = Field(default_factory=list)


class IconWorkbenchMessagePayload(BaseModel):
    content: str
    selected_folder_ids: list[str] = Field(default_factory=list)
    active_folder_id: str | None = None


class IconWorkbenchClientActionResultPayload(BaseModel):
    folder_id: str | None = None
    folder_name: str | None = None
    folder_path: str | None = None
    status: str
    message: str = ""


class IconWorkbenchClientActionReportPayload(BaseModel):
    action_type: str
    results: list[IconWorkbenchClientActionResultPayload] = Field(default_factory=list)
    skipped_items: list[IconWorkbenchClientActionResultPayload] = Field(default_factory=list)


def _is_masked_secret(value: Any) -> bool:
    return isinstance(value, str) and value and (value == "********" or "..." in value)


def _error_response(service: OrganizerSessionService, session_id: str | None, error_code: str, status_code: int):
    content = {"error_code": error_code}
    if session_id:
        try:
            content["session_snapshot"] = service.get_snapshot(session_id)
        except FileNotFoundError:
            pass
    return JSONResponse(status_code=status_code, content=content)


def _get_request_token(request: Request) -> str:
    header_token = request.headers.get("x-file-organizer-token", "").strip()
    if header_token:
        return header_token

    authorization = request.headers.get("authorization", "")
    if authorization.lower().startswith("bearer "):
        bearer_token = authorization[7:].strip()
        if bearer_token:
            return bearer_token

    return request.query_params.get("access_token", "").strip()


def _resolve_test_secret(
    payload: dict[str, Any],
    *,
    secret_key: str,
    reuse_flag_key: str,
    read_stored_secret,
) -> str:
    secret = payload.get(secret_key)
    if _is_masked_secret(secret):
        if payload.get(reuse_flag_key):
            return str(read_stored_secret() or "")
        raise ValueError("检测到当前密钥仍是脱敏展示值。若要复用已保存密钥，请保持原值不改并重试。")
    return str(secret or "")


def _describe_base_url_hint(base_url: str, *, image_generation: bool = False) -> str | None:
    normalized = str(base_url or "").strip().rstrip("/")
    if not normalized:
        return None
    if normalized.endswith("/v1"):
        return None
    if re.search(r"/chat/completions/?$", normalized):
        return None
    if image_generation and re.search(r"/images/generations/?$", normalized):
        return None
    return "接口地址通常需要带上 /v1 后缀；若服务商文档要求完整端点，也可以直接填写它给出的 /chat/completions 或 /images/generations 地址。"


def _normalize_image_generation_probe_url(base_url: str) -> str:
    normalized = str(base_url or "").strip()
    if not normalized:
        return ""
    if normalized.endswith("/images/generations"):
        return normalized
    if normalized.endswith("/v1"):
        return f"{normalized}/images/generations"
    if "/v1/" in normalized or normalized.endswith("/chat/completions"):
        return normalized
    return f"{normalized.rstrip('/')}/v1/images/generations"


def _probe_image_generation_endpoint(base_url: str, model: str, api_key: str) -> None:
    url = _normalize_image_generation_probe_url(base_url)
    payload = {
        "model": model,
        "prompt": "ping",
        "n": 1,
        "size": "256x256",
    }
    request = urllib_request.Request(
        url=url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )
    try:
        with urllib_request.urlopen(request, timeout=20):
            return
    except urllib_error.HTTPError as exc:
        if exc.code in {200, 201, 202, 400, 422, 429}:
            return
        raise


def create_app(service: OrganizerSessionService | None = None) -> FastAPI:
    setup_backend_logging()
    app = FastAPI(title="File Organizer Desktop API")
    app.state.service = service or OrganizerSessionService(SessionStore(Path("output/sessions")))
    from file_organizer.icon_workbench import IconWorkbenchService

    app.state.icon_workbench_service = IconWorkbenchService()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1:3000",
            "http://localhost:3000",
            "tauri://localhost",
            "http://tauri.localhost",
        ],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def require_api_token(request: Request, call_next):
        if request.method == "OPTIONS":
            return await call_next(request)

        path = request.url.path
        if path == "/api/health" or not path.startswith("/api/"):
            return await call_next(request)

        expected_token = os.getenv("FILE_ORGANIZER_API_TOKEN", "").strip()
        if expected_token and _get_request_token(request) != expected_token:
            return JSONResponse(status_code=401, content={"detail": "UNAUTHORIZED"})

        return await call_next(request)

    @app.get("/api/health")
    def health():
        return {"status": "ok", "instance_id": os.getenv("FILE_ORGANIZER_INSTANCE_ID")}

    @app.post("/api/sessions")
    def create_session(payload: CreateSessionPayload):
        try:
            result = app.state.service.create_session(
                payload.target_dir,
                payload.resume_if_exists,
                payload.strategy,
            )
        except RuntimeError as exc:
            if str(exc) == "SESSION_LOCKED":
                return _error_response(app.state.service, None, "SESSION_LOCKED", 409)
            raise
        session = result.session or result.restorable_session
        return {
            "mode": result.mode,
            "session_id": session.session_id if session else None,
            "restorable_session": (
                app.state.service.get_snapshot(result.restorable_session.session_id)
                if result.restorable_session
                else None
            ),
            "session_snapshot": app.state.service.get_snapshot(session.session_id) if session else None,
        }

    @app.get("/api/sessions/{session_id}")
    def get_session(session_id: str):
        try:
            return {
                "session_id": session_id,
                "session_snapshot": app.state.service.get_snapshot(session_id)
            }
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")

    @app.post("/api/sessions/{session_id}/resume")
    def resume_session(session_id: str):
        try:
            session = app.state.service.resume_session(session_id)
            return {
                "session_id": session_id,
                "session_snapshot": app.state.service.get_snapshot(session.session_id)
            }
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
        except RuntimeError as exc:
            if str(exc) == "SESSION_LOCKED":
                return _error_response(app.state.service, session_id, "SESSION_LOCKED", 409)
            raise

    @app.post("/api/sessions/{session_id}/abandon")
    def abandon_session(session_id: str):
        try:
            return {"session_id": session_id, "session_snapshot": app.state.service.abandon_session(session_id)}
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")

    @app.post("/api/sessions/{session_id}/scan")
    def start_scan(session_id: str):
        try:
            session = app.state.service.start_scan(session_id)
            return {
                "session_id": session.session_id,
                "session_snapshot": app.state.service.get_snapshot(session.session_id),
            }
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
        except RuntimeError as exc:
            if str(exc) == "scan_empty_result":
                return _error_response(app.state.service, session_id, "SCAN_EMPTY_RESULT", 409)
            return _error_response(app.state.service, session_id, "SESSION_STAGE_CONFLICT", 409)

    @app.post("/api/sessions/{session_id}/refresh")
    def refresh_session(session_id: str):
        try:
            result = app.state.service.refresh_session(session_id)
            return {"session_id": session_id, "session_snapshot": result.session_snapshot}
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
        except RuntimeError as exc:
            if str(exc) == "SESSION_STAGE_CONFLICT":
                return _error_response(app.state.service, session_id, "SESSION_STAGE_CONFLICT", 409)
            if str(exc) == "scan_empty_result":
                return _error_response(app.state.service, session_id, "SCAN_EMPTY_RESULT", 409)
            raise

    @app.post("/api/sessions/{session_id}/messages")
    def submit_message(session_id: str, payload: MessagePayload):
        try:
            result = app.state.service.submit_user_intent(session_id, payload.content)
            return {
                "session_id": session_id,
                "assistant_message": result.assistant_message,
                "session_snapshot": result.session_snapshot,
            }
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
        except RuntimeError:
            return _error_response(app.state.service, session_id, "SESSION_STAGE_CONFLICT", 409)

    @app.post("/api/sessions/{session_id}/update-item")
    def update_item(session_id: str, payload: UpdateItemPayload):
        try:
            result = app.state.service.update_item_target(
                session_id,
                payload.item_id,
                payload.target_dir,
                payload.move_to_review,
            )
            return {"session_id": session_id, "session_snapshot": result.session_snapshot}
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
        except RuntimeError as exc:
            if str(exc) == "ITEM_NOT_FOUND":
                raise HTTPException(status_code=404, detail="ITEM_NOT_FOUND")
            return _error_response(app.state.service, session_id, "SESSION_STAGE_CONFLICT", 409)

    @app.post("/api/sessions/{session_id}/unresolved-resolutions")
    def resolve_unresolved_choices(session_id: str, payload: dict):
        try:
            result = app.state.service.resolve_unresolved_choices(
                session_id,
                str(payload.get("request_id") or ""),
                list(payload.get("resolutions") or []),
            )
            return {
                "session_id": session_id,
                "assistant_message": result.assistant_message,
                "session_snapshot": result.session_snapshot,
            }
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        except RuntimeError as exc:
            if str(exc) == "UNRESOLVED_REQUEST_NOT_FOUND":
                return _error_response(app.state.service, session_id, "UNRESOLVED_REQUEST_NOT_FOUND", 409)
            if str(exc) == "UNRESOLVED_ITEM_CONFLICT":
                return _error_response(app.state.service, session_id, "UNRESOLVED_ITEM_CONFLICT", 409)
            return _error_response(app.state.service, session_id, "SESSION_STAGE_CONFLICT", 409)

    @app.post("/api/sessions/{session_id}/precheck")
    def precheck(session_id: str):
        try:
            result = app.state.service.run_precheck(session_id)
            return {"session_id": session_id, "session_snapshot": result.session_snapshot}
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
        except RuntimeError:
            return _error_response(app.state.service, session_id, "SESSION_STAGE_CONFLICT", 409)

    @app.post("/api/sessions/{session_id}/return-to-planning")
    def return_to_planning(session_id: str):
        try:
            result = app.state.service.return_to_planning(session_id)
            return {"session_id": session_id, "session_snapshot": result.session_snapshot}
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
        except RuntimeError:
            return _error_response(app.state.service, session_id, "SESSION_STAGE_CONFLICT", 409)

    @app.post("/api/sessions/{session_id}/execute")
    def execute(session_id: str, payload: ConfirmPayload):
        try:
            result = app.state.service.execute(session_id, payload.confirm)
            return {"session_id": session_id, "session_snapshot": result.session_snapshot}
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
        except RuntimeError as exc:
            if str(exc) == "SESSION_STAGE_CONFLICT":
                return _error_response(app.state.service, session_id, "SESSION_STAGE_CONFLICT", 409)
            if str(exc) == "SESSION_LOCKED":
                return _error_response(app.state.service, session_id, "SESSION_LOCKED", 409)
            raise

    @app.post("/api/sessions/{session_id}/rollback")
    def rollback(session_id: str, payload: ConfirmPayload):
        try:
            result = app.state.service.rollback(session_id, payload.confirm)
            return {"session_id": session_id, "session_snapshot": result.session_snapshot}
        except KeyError:
            raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
        except RuntimeError as exc:
            if str(exc) == "SESSION_STAGE_CONFLICT":
                return _error_response(app.state.service, session_id, "SESSION_STAGE_CONFLICT", 409)
            if str(exc) == "SESSION_LOCKED":
                return _error_response(app.state.service, session_id, "SESSION_LOCKED", 409)
            raise

    @app.post("/api/sessions/{session_id}/cleanup-empty-dirs")
    def cleanup_empty_dirs(session_id: str):
        try:
            return app.state.service.cleanup_empty_dirs(session_id)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
        except RuntimeError:
            return _error_response(app.state.service, session_id, "SESSION_STAGE_CONFLICT", 409)

    @app.get("/api/sessions/{session_id}/journal")
    def journal(session_id: str):
        try:
            return app.state.service.get_journal_summary(session_id)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")

    @app.get("/api/history")
    def list_history():
        return app.state.service.list_history()

    @app.delete("/api/history/{entry_id}")
    def delete_history(entry_id: str):
        try:
            return app.state.service.delete_history_entry(entry_id)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="HISTORY_ENTRY_NOT_FOUND")

    @app.get("/api/sessions/{session_id}/events")
    def events(session_id: str, request: Request):
        def stream():
            snapshot = app.state.service.get_snapshot(session_id)
            initial_event = {
                "event_type": "session.snapshot",
                "session_id": session_id,
                "stage": snapshot["stage"],
                "session_snapshot": snapshot,
            }
            yield "event: session.snapshot\n"
            yield f"data: {json.dumps(initial_event, ensure_ascii=False)}\n\n"
            if request.headers.get("x-file-organizer-once") == "1":
                return
            subscriber = app.state.service.subscribe(session_id)
            try:
                while True:
                    try:
                        event = subscriber.get(timeout=5)
                    except Empty:
                        yield ": keep-alive\n\n"
                        continue
                    yield f"event: {event['event_type']}\n"
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            finally:
                app.state.service.unsubscribe(session_id, subscriber)

        return StreamingResponse(stream(), media_type="text/event-stream")

    @app.post("/api/utils/open-dir")
    def open_dir(payload: OpenDirPayload):
        path = payload.path
        if not path or not os.path.exists(path):
            raise HTTPException(status_code=400, detail="INVALID_PATH")

        import subprocess
        try:
            subprocess.run(["explorer", os.path.abspath(path)], check=True)
            return {"status": "ok"}
        except Exception:
            logger.exception("打开目录失败", extra={"path": path})
            raise HTTPException(status_code=500, detail="OPEN_DIR_FAILED")

    @app.post("/api/utils/select-dir")
    def select_dir():
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)

        directory = filedialog.askdirectory(title="选择要整理的文件夹")
        root.destroy()

        if directory:
            return {"path": os.path.abspath(directory)}
        return {"path": None}

    @app.post("/api/icon-workbench/sessions")
    def create_icon_workbench_session(payload: IconWorkbenchCreatePayload):
        try:
            return app.state.icon_workbench_service.create_session(payload.target_paths)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.get("/api/icon-workbench/sessions/{session_id}")
    def get_icon_workbench_session(session_id: str):
        try:
            return app.state.icon_workbench_service.get_session(session_id)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="ICON_SESSION_NOT_FOUND")

    @app.post("/api/icon-workbench/sessions/{session_id}/scan")
    def scan_icon_workbench_session(session_id: str):
        try:
            return app.state.icon_workbench_service.scan_session(session_id)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="ICON_SESSION_NOT_FOUND")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.post("/api/icon-workbench/sessions/{session_id}/targets")
    def update_icon_workbench_targets(session_id: str, payload: IconWorkbenchTargetUpdatePayload):
        try:
            return app.state.icon_workbench_service.update_session_targets(session_id, payload.target_paths, payload.mode)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="ICON_SESSION_NOT_FOUND")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.delete("/api/icon-workbench/sessions/{session_id}/targets/{folder_id}")
    def remove_icon_workbench_target(session_id: str, folder_id: str):
        try:
            return app.state.icon_workbench_service.remove_session_target(session_id, folder_id)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="ICON_FOLDER_NOT_FOUND")

    @app.post("/api/icon-workbench/sessions/{session_id}/analyze")
    def analyze_icon_workbench_session(session_id: str, payload: IconWorkbenchFolderBatchPayload):
        try:
            return app.state.icon_workbench_service.analyze_folders(session_id, payload.folder_ids)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="ICON_FOLDER_NOT_FOUND")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.post("/api/icon-workbench/sessions/{session_id}/generate")
    def generate_icon_workbench_previews(session_id: str, payload: IconWorkbenchFolderBatchPayload):
        try:
            return app.state.icon_workbench_service.generate_previews(session_id, payload.folder_ids)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="ICON_FOLDER_NOT_FOUND")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.post("/api/icon-workbench/sessions/{session_id}/folders/{folder_id}/prompt")
    def update_icon_workbench_prompt(session_id: str, folder_id: str, payload: IconWorkbenchPromptPayload):
        try:
            return app.state.icon_workbench_service.update_folder_prompt(session_id, folder_id, payload.prompt)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="ICON_FOLDER_NOT_FOUND")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.post("/api/icon-workbench/sessions/{session_id}/folders/{folder_id}/select-version")
    def select_icon_workbench_version(session_id: str, folder_id: str, payload: IconWorkbenchSelectVersionPayload):
        try:
            return app.state.icon_workbench_service.select_version(session_id, folder_id, payload.version_id)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="ICON_VERSION_NOT_FOUND")

    @app.get("/api/icon-workbench/sessions/{session_id}/folders/{folder_id}/versions/{version_id}/image")
    def get_icon_workbench_image(session_id: str, folder_id: str, version_id: str):
        try:
            path = app.state.icon_workbench_service.get_version_image_path(session_id, folder_id, version_id)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="ICON_IMAGE_NOT_FOUND")
        return FileResponse(path)

    @app.get("/api/icon-workbench/config")
    def get_icon_workbench_config():
        return app.state.icon_workbench_service.get_config()

    @app.post("/api/icon-workbench/config")
    def update_icon_workbench_config(payload: dict):
        return app.state.icon_workbench_service.update_config(payload)

    @app.post("/api/icon-workbench/config/presets/switch")
    def switch_icon_workbench_config_preset(payload: IconWorkbenchConfigPresetSwitchPayload):
        try:
            return app.state.icon_workbench_service.switch_config_preset(payload.id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.post("/api/icon-workbench/config/presets")
    def add_icon_workbench_config_preset(payload: IconWorkbenchConfigPresetCreatePayload):
        try:
            return app.state.icon_workbench_service.add_config_preset(payload.name, payload.config)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.delete("/api/icon-workbench/config/presets/{preset_id}")
    def delete_icon_workbench_config_preset(preset_id: str):
        try:
            return app.state.icon_workbench_service.delete_config_preset(preset_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.get("/api/icon-workbench/templates")
    def list_icon_workbench_templates():
        return {"templates": app.state.icon_workbench_service.list_templates()}

    @app.post("/api/icon-workbench/templates")
    def create_icon_workbench_template(payload: IconWorkbenchTemplatePayload):
        try:
            template = app.state.icon_workbench_service.create_template(payload.model_dump())
            return {"template": template}
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.patch("/api/icon-workbench/templates/{template_id}")
    def update_icon_workbench_template(template_id: str, payload: IconWorkbenchTemplateUpdatePayload):
        try:
            template = app.state.icon_workbench_service.update_template(template_id, payload.model_dump(exclude_none=True))
            return {"template": template}
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="ICON_TEMPLATE_NOT_FOUND")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.delete("/api/icon-workbench/templates/{template_id}")
    def delete_icon_workbench_template(template_id: str):
        try:
            return app.state.icon_workbench_service.delete_template(template_id)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="ICON_TEMPLATE_NOT_FOUND")

    @app.post("/api/icon-workbench/sessions/{session_id}/apply-template")
    def apply_icon_workbench_template(session_id: str, payload: IconWorkbenchApplyTemplatePayload):
        try:
            return app.state.icon_workbench_service.apply_template(session_id, payload.template_id, payload.folder_ids)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="ICON_TEMPLATE_OR_FOLDER_NOT_FOUND")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.post("/api/icon-workbench/sessions/{session_id}/apply-ready")
    def prepare_icon_workbench_apply_ready(session_id: str, payload: IconWorkbenchFolderBatchPayload):
        try:
            return app.state.icon_workbench_service.prepare_apply_ready(session_id, payload.folder_ids)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="ICON_FOLDER_NOT_FOUND")

    @app.post("/api/icon-workbench/sessions/{session_id}/messages")
    def send_icon_workbench_message(session_id: str, payload: IconWorkbenchMessagePayload):
        try:
            session = app.state.icon_workbench_service.send_message(
                session_id,
                payload.content,
                selected_folder_ids=payload.selected_folder_ids,
                active_folder_id=payload.active_folder_id,
            )
            return {"session": session}
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="ICON_SESSION_NOT_FOUND")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.post("/api/icon-workbench/sessions/{session_id}/actions/{action_id}/confirm")
    def confirm_icon_workbench_action(session_id: str, action_id: str):
        try:
            return app.state.icon_workbench_service.confirm_pending_action(session_id, action_id)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="ICON_ACTION_NOT_FOUND")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.post("/api/icon-workbench/sessions/{session_id}/actions/{action_id}/dismiss")
    def dismiss_icon_workbench_action(session_id: str, action_id: str):
        try:
            session = app.state.icon_workbench_service.dismiss_pending_action(session_id, action_id)
            return {"session": session}
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="ICON_ACTION_NOT_FOUND")

    @app.post("/api/icon-workbench/sessions/{session_id}/client-actions/report")
    def report_icon_workbench_client_action(session_id: str, payload: IconWorkbenchClientActionReportPayload):
        try:
            session = app.state.icon_workbench_service.report_client_action(session_id, payload.model_dump())
            return {"session": session}
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="ICON_SESSION_NOT_FOUND")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    @app.post("/api/icon-workbench/sessions/{session_id}/folders/{folder_id}/versions/{version_id}/add-processed")
    async def add_icon_workbench_processed_version(
        session_id: str,
        folder_id: str,
        version_id: str,
        request: Request,
        suffix: str = "processed"
    ):
        try:
            image_bytes = await request.body()
            if not image_bytes:
                raise HTTPException(status_code=400, detail="EMPTY_IMAGE_DATA")
            
            session = app.state.icon_workbench_service.add_processed_version(
                session_id,
                folder_id,
                version_id,
                image_bytes,
                suffix=suffix
            )
            return {"session": session}
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="ICON_ENTITY_NOT_FOUND")
        except Exception as exc:
            logger.exception("Register processed version failed")
            raise HTTPException(status_code=500, detail=str(exc))

    @app.get("/api/utils/config")
    def get_config():
        from file_organizer.shared.config_manager import config_manager
        return config_manager.get_config_payload(mask_secrets=True)

    @app.post("/api/utils/config")
    def update_config(payload: dict):
        from file_organizer.shared.config_manager import config_manager
        config_manager.update_active_profile(payload)
        return {"status": "ok"}

    @app.post("/api/utils/config/secrets")
    def get_config_secrets(payload: ConfigSecretsPayload):
        from file_organizer.shared.config_manager import config_manager
        return {"secrets": config_manager.get_secret_values(payload.keys)}

    @app.post("/api/utils/config/presets/switch")
    def switch_config(payload: PresetSwitchPayload):
        from file_organizer.shared.config_manager import config_manager
        config_manager.switch_preset(payload.preset_type, payload.id)
        return {"status": "ok"}

    @app.post("/api/utils/config/presets")
    def add_profile(payload: AddPresetPayload):
        from file_organizer.shared.config_manager import config_manager
        new_id = config_manager.add_preset(
            payload.preset_type,
            payload.name,
            copy_from_active=payload.copy_profile,
            config_patch=payload.config,
        )
        return {"status": "ok", "id": new_id}

    @app.delete("/api/utils/config/presets/{preset_type}/{preset_id}")
    def delete_profile(preset_type: str, preset_id: str):
        from file_organizer.shared.config_manager import config_manager
        config_manager.delete_preset(preset_type, preset_id)
        return {"status": "ok"}

    @app.post("/api/utils/test-llm")
    def test_llm(payload: LlmTestPayload):
        from openai import OpenAI
        from file_organizer.shared.config_manager import config_manager

        raw_payload = payload.model_dump()
        test_type = raw_payload.get("test_type", "text")

        if test_type == "vision":
            try:
                api_key = _resolve_test_secret(
                    raw_payload,
                    secret_key="IMAGE_ANALYSIS_API_KEY",
                    reuse_flag_key="IMAGE_ANALYSIS_API_KEY_USE_STORED",
                    read_stored_secret=lambda: config_manager.get("IMAGE_ANALYSIS_API_KEY"),
                )
            except ValueError as exc:
                return JSONResponse(status_code=400, content={"status": "error", "message": str(exc)})
            base_url = raw_payload.get("IMAGE_ANALYSIS_BASE_URL")
            model = raw_payload.get("IMAGE_ANALYSIS_MODEL")
            if not raw_payload.get("IMAGE_ANALYSIS_ENABLED"):
                return JSONResponse(
                    status_code=400,
                    content={"status": "error", "message": "图片理解尚未启用，请先打开开关。"},
                )
            if not base_url or not model or not api_key:
                hint = _describe_base_url_hint(str(base_url or ""))
                return JSONResponse(
                    status_code=400,
                    content={
                        "status": "error",
                        "message": "图片模型配置不完整，请补全接口地址、模型 ID 和 API 密钥。"
                        + (f" {hint}" if hint else ""),
                    },
                )
        elif test_type == "icon_image":
            try:
                api_key = _resolve_test_secret(
                    raw_payload,
                    secret_key="ICON_IMAGE_API_KEY",
                    reuse_flag_key="ICON_IMAGE_API_KEY_USE_STORED",
                    read_stored_secret=lambda: app.state.icon_workbench_service.get_config().get("image_model", {}).get("api_key"),
                )
            except ValueError as exc:
                return JSONResponse(status_code=400, content={"status": "error", "message": str(exc)})
            base_url = raw_payload.get("ICON_IMAGE_BASE_URL")
            model = raw_payload.get("ICON_IMAGE_MODEL")
            if not base_url or not model or not api_key:
                hint = _describe_base_url_hint(str(base_url or ""), image_generation=True)
                return JSONResponse(
                    status_code=400,
                    content={
                        "status": "error",
                        "message": "图像生成模型配置不完整，请补全接口地址、模型 ID 和 API 密钥。"
                        + (f" {hint}" if hint else ""),
                    },
                )
        else:
            try:
                api_key = _resolve_test_secret(
                    raw_payload,
                    secret_key="OPENAI_API_KEY",
                    reuse_flag_key="OPENAI_API_KEY_USE_STORED",
                    read_stored_secret=lambda: config_manager.get("OPENAI_API_KEY"),
                )
            except ValueError as exc:
                return JSONResponse(status_code=400, content={"status": "error", "message": str(exc)})
            base_url = raw_payload.get("OPENAI_BASE_URL")
            model = raw_payload.get("OPENAI_MODEL")
            if not base_url or not model or not api_key:
                hint = _describe_base_url_hint(str(base_url or ""))
                return JSONResponse(
                    status_code=400,
                    content={
                        "status": "error",
                        "message": "文本模型配置不完整，请补全接口地址、模型 ID 和 API 密钥。"
                        + (f" {hint}" if hint else ""),
                    },
                )

        try:
            client = OpenAI(api_key=api_key, base_url=base_url)
            if test_type == "icon_image":
                try:
                    client.models.list()
                except Exception as exc:
                    status_code = getattr(exc, "status_code", None)
                    if status_code is None:
                        response = getattr(exc, "response", None)
                        status_code = getattr(response, "status_code", None)
                    if status_code not in {404, 405, 501} and "404" not in str(exc):
                        raise
                    _probe_image_generation_endpoint(str(base_url or ""), str(model or ""), str(api_key or ""))
            else:
                client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": "ping"}],
                    max_tokens=1,
                )
            type_label = "图片理解" if test_type == "vision" else ("图像生成" if test_type == "icon_image" else "文本模型")
            return {"status": "ok", "message": f"{type_label}连接测试已通过。"}
        except Exception:
            logger.exception("模型链路连通性测试失败", extra={"test_type": test_type})
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": "连接测试失败，请检查接口地址、模型 ID、API 密钥和网络状态。"}
            )

    return app
