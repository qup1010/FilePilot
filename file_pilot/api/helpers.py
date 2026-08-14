"""路由共享的请求辅助函数。"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import Request
from fastapi.responses import JSONResponse

if TYPE_CHECKING:
    from file_pilot.app.session_service import OrganizerSessionService


def error_response(
    service: "OrganizerSessionService",
    session_id: str | None,
    error_code: str,
    status_code: int,
) -> JSONResponse:
    content = {"error_code": error_code}
    if session_id:
        try:
            content["session_snapshot"] = service.get_snapshot(session_id)
        except FileNotFoundError:
            pass
    return JSONResponse(status_code=status_code, content=content)


def get_request_token(request: Request) -> str:
    header_token = request.headers.get("x-file-pilot-token", "").strip()
    if header_token:
        return header_token

    authorization = request.headers.get("authorization", "")
    if authorization.lower().startswith("bearer "):
        bearer_token = authorization[7:].strip()
        if bearer_token:
            return bearer_token

    return request.query_params.get("access_token", "").strip()


def request_once(request: Request) -> bool:
    return request.headers.get("x-file-pilot-once") == "1"
