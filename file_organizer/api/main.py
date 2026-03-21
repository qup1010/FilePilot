from __future__ import annotations

import json
import os
from pathlib import Path
from queue import Empty

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from file_organizer.app.session_service import OrganizerSessionService
from file_organizer.app.session_store import SessionStore


def _error_response(service: OrganizerSessionService, session_id: str | None, error_code: str, status_code: int):
    content = {"error_code": error_code}
    if session_id:
        try:
            content["session_snapshot"] = service.get_snapshot(session_id)
        except FileNotFoundError:
            pass
    return JSONResponse(status_code=status_code, content=content)


def create_app(service: OrganizerSessionService | None = None) -> FastAPI:
    app = FastAPI(title="File Organizer Desktop API")
    app.state.service = service or OrganizerSessionService(SessionStore(Path("output/sessions")))
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health():
        return {"status": "ok", "instance_id": os.getenv("FILE_ORGANIZER_INSTANCE_ID")}

    @app.post("/api/sessions")
    def create_session(payload: dict):
        try:
            result = app.state.service.create_session(
                payload["target_dir"],
                bool(payload.get("resume_if_exists", False)),
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
            return app.state.service.get_snapshot(session_id)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")

    @app.post("/api/sessions/{session_id}/resume")
    def resume_session(session_id: str):
        try:
            session = app.state.service.resume_session(session_id)
            return app.state.service.get_snapshot(session.session_id)
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
    def submit_message(session_id: str, payload: dict):
        try:
            result = app.state.service.submit_user_intent(session_id, payload["content"])
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
    def update_item(session_id: str, payload: dict):
        try:
            result = app.state.service.update_item_target(
                session_id,
                payload["item_id"],
                payload.get("target_dir"),
                bool(payload.get("move_to_review", False)),
            )
            return {
                "session_id": session_id,
                "session_snapshot": result.session_snapshot,
            }
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
        except KeyError:
            raise HTTPException(status_code=404, detail="ITEM_NOT_FOUND")
        except RuntimeError as exc:
            if str(exc) == "SESSION_STAGE_CONFLICT":
                return _error_response(app.state.service, session_id, "SESSION_STAGE_CONFLICT", 409)
            raise

    @app.post("/api/sessions/{session_id}/precheck")
    def precheck(session_id: str):
        try:
            result = app.state.service.run_precheck(session_id)
            return {"session_id": session_id, "session_snapshot": result.session_snapshot}
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
        except RuntimeError:
            return _error_response(app.state.service, session_id, "SESSION_STAGE_CONFLICT", 409)

    @app.post("/api/sessions/{session_id}/execute")
    def execute(session_id: str, payload: dict):
        try:
            result = app.state.service.execute(session_id, bool(payload.get("confirm", False)))
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
    def rollback(session_id: str, payload: dict):
        try:
            result = app.state.service.rollback(session_id, bool(payload.get("confirm", False)))
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

    @app.get("/api/sessions/{session_id}/events")
    def events(session_id: str):
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
    def open_dir(payload: dict):
        path = payload.get("path")
        if not path or not os.path.exists(path):
            raise HTTPException(status_code=400, detail="INVALID_PATH")
        
        # 兼容 Windows 系统打开目录命令
        import subprocess
        try:
            subprocess.run(["explorer", os.path.abspath(path)], check=True)
            return {"status": "ok"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.post("/api/utils/select-dir")
    def select_dir():
        import tkinter as tk
        from tkinter import filedialog
        
        # 初始化隐藏的主窗口，防止弹出一个空的 tk 窗口
        root = tk.Tk()
        root.withdraw()
        # 让弹窗出现在最前面
        root.attributes("-topmost", True)
        
        directory = filedialog.askdirectory(title="选择要整理的文件夹")
        root.destroy()
        
        if directory:
            return {"path": os.path.abspath(directory)}
        return {"path": None}

    return app
