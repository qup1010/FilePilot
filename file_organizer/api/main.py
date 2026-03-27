from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from queue import Empty
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
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


class LlmTestPayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    test_type: str = "text"


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


def create_app(service: OrganizerSessionService | None = None) -> FastAPI:
    setup_backend_logging()
    app = FastAPI(title="File Organizer Desktop API")
    app.state.service = service or OrganizerSessionService(SessionStore(Path("output/sessions")))
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
        except RuntimeError:
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

    @app.get("/api/utils/config")
    def get_config():
        from file_organizer.shared.config_manager import config_manager
        return config_manager.get_config_payload(mask_secrets=True)

    @app.post("/api/utils/config")
    def update_config(payload: dict):
        from file_organizer.shared.config_manager import config_manager
        config_manager.update_active_profile(payload)
        return {"status": "ok"}

    @app.post("/api/utils/config/presets/switch")
    def switch_config(payload: PresetSwitchPayload):
        from file_organizer.shared.config_manager import config_manager
        config_manager.switch_preset(payload.preset_type, payload.id)
        return {"status": "ok"}

    @app.post("/api/utils/config/presets")
    def add_profile(payload: AddPresetPayload):
        from file_organizer.shared.config_manager import config_manager
        new_id = config_manager.add_preset(payload.preset_type, payload.name, copy_from_active=payload.copy_profile)
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
            api_key = raw_payload.get("IMAGE_ANALYSIS_API_KEY")
            base_url = raw_payload.get("IMAGE_ANALYSIS_BASE_URL")
            model = raw_payload.get("IMAGE_ANALYSIS_MODEL")
            if _is_masked_secret(api_key):
                api_key = config_manager.get("IMAGE_ANALYSIS_API_KEY")
            if not raw_payload.get("IMAGE_ANALYSIS_ENABLED"):
                return JSONResponse(
                    status_code=400,
                    content={"status": "error", "message": "图片理解未开启"},
                )
            if not base_url or not model or not api_key:
                return JSONResponse(
                    status_code=400,
                    content={"status": "error", "message": "图片模型需要完整填写接口地址、模型 ID 和 API 密钥"},
                )
        else:
            api_key = raw_payload.get("OPENAI_API_KEY")
            base_url = raw_payload.get("OPENAI_BASE_URL")
            model = raw_payload.get("OPENAI_MODEL")
            if _is_masked_secret(api_key):
                api_key = config_manager.get("OPENAI_API_KEY")
            if not base_url or not model or not api_key:
                return JSONResponse(
                    status_code=400,
                    content={"status": "error", "message": "文本模型需要完整填写接口地址、模型 ID 和 API 密钥"},
                )

        try:
            client = OpenAI(api_key=api_key, base_url=base_url)
            client.models.list()
            return {"status": "ok", "message": f"{'视觉' if test_type == 'vision' else '文本'}模型链路连通性测试通过"}
        except Exception:
            logger.exception("模型链路连通性测试失败", extra={"test_type": test_type})
            return JSONResponse(
                status_code=400,
                content={"status": "error", "message": "模型链路连通性测试失败"}
            )

    return app
