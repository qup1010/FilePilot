"""FastAPI 应用装配：中间件、健康检查与各资源域路由的挂载。

具体路由实现见 file_pilot/api/routers/，请求体模型见 file_pilot/api/payloads.py。
"""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response

from file_pilot.analysis.vision_runtime import resolve_registered_vision_image
from file_pilot.api.helpers import get_request_token
from file_pilot.api.routers import (
    history_router,
    icon_workbench_router,
    sessions_router,
    settings_router,
    target_profiles_router,
    utils_router,
)
from file_pilot.app.session_service import OrganizerSessionService
from file_pilot.app.session_store import SessionStore
from file_pilot.shared.config import SESSIONS_DIR
from file_pilot.shared.logging_utils import setup_backend_logging

logger = logging.getLogger(__name__)


def create_app(service: OrganizerSessionService | None = None) -> FastAPI:
    setup_backend_logging()
    app = FastAPI(title="FilePilot API")
    app.state.service = service or OrganizerSessionService(SessionStore(SESSIONS_DIR))
    from file_pilot.icon_workbench import IconWorkbenchService

    app.state.icon_workbench_service = IconWorkbenchService()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1:3000",
            "http://localhost:3000",
            "tauri://localhost",
            "http://tauri.localhost",
            "https://tauri.localhost",
        ],
        allow_origin_regex=r"https?://(127\.0\.0\.1|localhost|tauri\.localhost)(:\d+)?$",
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

        expected_token = os.getenv("FILE_PILOT_API_TOKEN", "").strip()
        if expected_token and get_request_token(request) != expected_token:
            return JSONResponse(status_code=401, content={"detail": "UNAUTHORIZED"})

        return await call_next(request)

    @app.get("/api/health")
    def health():
        return {"status": "ok", "instance_id": os.getenv("FILE_PILOT_INSTANCE_ID", "").strip()}

    @app.get("/_filepilot/vision-images/{token}")
    def get_registered_vision_image(token: str):
        item = resolve_registered_vision_image(token)
        if item is None:
            raise HTTPException(status_code=404, detail="VISION_IMAGE_NOT_FOUND")
        if item.path is not None:
            return FileResponse(item.path, media_type=item.mime_type)
        return Response(content=item.data or b"", media_type=item.mime_type)

    app.include_router(sessions_router)
    app.include_router(target_profiles_router)
    app.include_router(history_router)
    app.include_router(icon_workbench_router)
    app.include_router(settings_router)
    app.include_router(utils_router)

    return app
