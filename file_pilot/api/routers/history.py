"""整理历史路由。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api/history")


@router.get("")
def list_history(request: Request):
    return request.app.state.service.list_history()


@router.delete("/{entry_id}")
def delete_history(entry_id: str, request: Request):
    try:
        return request.app.state.service.delete_history_entry(entry_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="HISTORY_ENTRY_NOT_FOUND")
    except RuntimeError as exc:
        if str(exc) == "SESSION_LOCKED":
            raise HTTPException(status_code=409, detail="SESSION_LOCKED")
        raise
