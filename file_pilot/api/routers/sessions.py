"""整理会话相关路由。

服务实例统一在请求时通过 ``request.app.state.service`` 解析，
不在注册时捕获——测试会在 create_app 之后替换 app.state 上的服务。
"""

from __future__ import annotations

import json
from queue import Empty
from typing import TYPE_CHECKING

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from file_pilot.api.helpers import error_response, request_once
from file_pilot.api.payloads import (
    ConfirmPayload,
    ConfirmTargetsPayload,
    CreateSessionPayload,
    MessagePayload,
    RestoreAiMappingPayload,
    UpdateItemPayload,
)

if TYPE_CHECKING:
    from file_pilot.app.session_service import OrganizerSessionService

router = APIRouter(prefix="/api/sessions")


def _service(request: Request) -> "OrganizerSessionService":
    return request.app.state.service


@router.post("")
def create_session(payload: CreateSessionPayload, request: Request):
    service = _service(request)
    if not payload.sources and not str(payload.target_dir or "").strip():
        raise HTTPException(
            status_code=422,
            detail=[
                {
                    "type": "missing",
                    "loc": ["body", "target_dir"],
                    "msg": "Field required",
                    "input": payload.model_dump(),
                }
            ],
        )
    try:
        result = service.create_session(
            payload.sources or str(payload.target_dir or ""),
            payload.resume_if_exists,
            payload.organize_method,
            payload.strategy,
            output_dir=str(payload.output_dir or ""),
            target_profile_id=str(payload.target_profile_id or ""),
            target_directories=list(payload.target_directories or []),
            target_directory_details=[
                item.model_dump(exclude_none=True)
                for item in (payload.target_directory_details or [])
            ],
            new_directory_root=str(payload.new_directory_root or ""),
            review_root=str(payload.review_root or ""),
            unattended=bool(payload.unattended),
        )
    except ValueError as exc:
        if str(exc) == "TASK_TYPE_CONFLICT":
            return JSONResponse(status_code=400, content={"error_code": "TASK_TYPE_CONFLICT"})
        if str(exc) in {
            "SOURCES_REQUIRED",
            "SOURCE_PATH_EMPTY",
            "SOURCE_PATH_DRIVE_ROOT",
            "SOURCE_PATH_PROJECT_ROOT",
            "SOURCE_PATH_SYSTEM_PROTECTED",
            "OUTPUT_DIR_REQUIRED",
            "NEW_DIRECTORY_ROOT_REQUIRED",
            "REVIEW_ROOT_REQUIRED",
            "REVIEW_ROOT_CONFLICT",
            "TARGET_DIRECTORIES_REQUIRED",
            "TARGET_PROFILE_NOT_FOUND",
            "UNATTENDED_REQUIRES_EXISTING_CATEGORIES",
            "TARGET_RULES_INCOMPLETE",
        }:
            return JSONResponse(status_code=400, content={"error_code": str(exc)})
        raise
    except RuntimeError as exc:
        if str(exc) == "SESSION_LOCKED":
            return error_response(service, None, "SESSION_LOCKED", 409)
        raise
    session = result.session or result.restorable_session
    return {
        "mode": result.mode,
        "session_id": session.session_id if session else None,
        "restorable_session": (
            service.get_snapshot(result.restorable_session.session_id)
            if result.restorable_session
            else None
        ),
        "session_snapshot": service.get_snapshot(session.session_id) if session else None,
    }


@router.get("/{session_id}")
def get_session(session_id: str, request: Request):
    try:
        return {
            "session_id": session_id,
            "session_snapshot": _service(request).get_snapshot(session_id),
        }
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")


@router.post("/{session_id}/resume")
def resume_session(session_id: str, request: Request):
    service = _service(request)
    try:
        session = service.resume_session(session_id)
        return {
            "session_id": session_id,
            "session_snapshot": service.get_snapshot(session.session_id),
        }
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    except RuntimeError as exc:
        if str(exc) == "SESSION_LOCKED":
            return error_response(service, session_id, "SESSION_LOCKED", 409)
        raise


@router.post("/{session_id}/abandon")
def abandon_session(session_id: str, request: Request):
    service = _service(request)
    try:
        return {"session_id": session_id, "session_snapshot": service.abandon_session(session_id)}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    except RuntimeError as exc:
        if str(exc) == "SESSION_LOCKED":
            return error_response(service, session_id, "SESSION_LOCKED", 409)
        raise


@router.post("/{session_id}/scan")
def start_scan(session_id: str, request: Request):
    service = _service(request)
    try:
        session = service.start_scan(session_id)
        return {
            "session_id": session.session_id,
            "session_snapshot": service.get_snapshot(session.session_id),
        }
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    except RuntimeError as exc:
        if str(exc) == "scan_empty_result":
            return error_response(service, session_id, "SCAN_EMPTY_RESULT", 409)
        return error_response(service, session_id, "SESSION_STAGE_CONFLICT", 409)


@router.post("/{session_id}/refresh")
def refresh_session(session_id: str, request: Request):
    service = _service(request)
    try:
        result = service.refresh_session(session_id)
        return {"session_id": session_id, "session_snapshot": result.session_snapshot}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    except RuntimeError as exc:
        if str(exc) == "SESSION_STAGE_CONFLICT":
            return error_response(service, session_id, "SESSION_STAGE_CONFLICT", 409)
        if str(exc) == "scan_empty_result":
            return error_response(service, session_id, "SCAN_EMPTY_RESULT", 409)
        raise


@router.post("/{session_id}/messages")
def submit_message(session_id: str, payload: MessagePayload, request: Request):
    service = _service(request)
    try:
        result = service.submit_user_intent(session_id, payload.content)
        return {
            "session_id": session_id,
            "assistant_message": result.assistant_message,
            "session_snapshot": result.session_snapshot,
        }
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    except RuntimeError:
        return error_response(service, session_id, "SESSION_STAGE_CONFLICT", 409)


def _confirm_target_directories(service: "OrganizerSessionService", session_id: str, payload: ConfirmTargetsPayload):
    try:
        result = service.confirm_target_directories(session_id, payload.selected_target_dirs)
        return {
            "session_id": session_id,
            "assistant_message": result.assistant_message,
            "session_snapshot": result.session_snapshot,
        }
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    except RuntimeError as exc:
        code = str(exc)
        if code in {
            "INCREMENTAL_TARGET_DIR_NOT_FOUND",
            "INCREMENTAL_TARGETS_EMPTY",
            "INCREMENTAL_SOURCE_EMPTY",
            "SESSION_STAGE_CONFLICT",
        }:
            return error_response(service, session_id, code, 409)
        raise


@router.post("/{session_id}/incremental-selection")
def submit_incremental_selection(session_id: str, payload: ConfirmTargetsPayload, request: Request):
    return _confirm_target_directories(_service(request), session_id, payload)


@router.post("/{session_id}/confirm-targets")
def confirm_target_directories(session_id: str, payload: ConfirmTargetsPayload, request: Request):
    return _confirm_target_directories(_service(request), session_id, payload)


@router.post("/{session_id}/update-item")
def update_item(session_id: str, payload: UpdateItemPayload, request: Request):
    service = _service(request)
    try:
        result = service.update_item_target(
            session_id,
            payload.item_id,
            payload.target_dir,
            payload.target_slot,
            payload.move_to_review,
        )
        return {"session_id": session_id, "session_snapshot": result.session_snapshot}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    except RuntimeError as exc:
        if str(exc) == "ITEM_NOT_FOUND":
            raise HTTPException(status_code=404, detail="ITEM_NOT_FOUND")
        if str(exc) == "TARGET_SLOT_NOT_FOUND":
            raise HTTPException(status_code=404, detail="TARGET_SLOT_NOT_FOUND")
        if str(exc) in {"ABSOLUTE_TARGET_DIR_NOT_ALLOWED", "REVIEW_SUBDIRECTORY_NOT_ALLOWED", "TARGET_DIR_OUTSIDE_ROOT"}:
            return error_response(service, session_id, str(exc), 400)
        if str(exc) == "INCREMENTAL_TARGET_NOT_ALLOWED":
            return error_response(service, session_id, "INCREMENTAL_TARGET_NOT_ALLOWED", 409)
        return error_response(service, session_id, "SESSION_STAGE_CONFLICT", 409)


@router.post("/{session_id}/restore-ai-suggestion")
def restore_ai_suggestion(session_id: str, payload: RestoreAiMappingPayload, request: Request):
    service = _service(request)
    try:
        result = service.restore_ai_mapping(session_id, payload.item_id)
        return {"session_id": session_id, "session_snapshot": result.session_snapshot}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    except RuntimeError as exc:
        if str(exc) == "ITEM_NOT_FOUND":
            raise HTTPException(status_code=404, detail="ITEM_NOT_FOUND")
        if str(exc) == "AI_SUGGESTION_NOT_FOUND":
            return error_response(service, session_id, "AI_SUGGESTION_NOT_FOUND", 409)
        return error_response(service, session_id, "SESSION_STAGE_CONFLICT", 409)


@router.post("/{session_id}/apply-target-conflict-suggestions")
def apply_target_conflict_suggestions(session_id: str, request: Request):
    service = _service(request)
    try:
        result = service.apply_target_conflict_suggestions(session_id)
        return {"session_id": session_id, "session_snapshot": result.session_snapshot}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    except RuntimeError as exc:
        if str(exc) == "ITEM_NOT_FOUND":
            raise HTTPException(status_code=404, detail="ITEM_NOT_FOUND")
        if str(exc) == "TARGET_CONFLICT_SUGGESTIONS_NOT_FOUND":
            return error_response(service, session_id, "TARGET_CONFLICT_SUGGESTIONS_NOT_FOUND", 409)
        return error_response(service, session_id, "SESSION_STAGE_CONFLICT", 409)


@router.post("/{session_id}/precheck")
def precheck(session_id: str, request: Request):
    service = _service(request)
    try:
        result = service.run_precheck(session_id)
        return {"session_id": session_id, "session_snapshot": result.session_snapshot}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    except RuntimeError:
        return error_response(service, session_id, "SESSION_STAGE_CONFLICT", 409)


@router.post("/{session_id}/return-to-planning")
def return_to_planning(session_id: str, request: Request):
    service = _service(request)
    try:
        result = service.return_to_planning(session_id)
        return {"session_id": session_id, "session_snapshot": result.session_snapshot}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    except RuntimeError:
        return error_response(service, session_id, "SESSION_STAGE_CONFLICT", 409)


@router.post("/{session_id}/execute")
def execute(session_id: str, payload: ConfirmPayload, request: Request):
    service = _service(request)
    try:
        result = service.execute(session_id, payload.confirm)
        return {"session_id": session_id, "session_snapshot": result.session_snapshot}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    except RuntimeError as exc:
        if str(exc) == "SESSION_STAGE_CONFLICT":
            return error_response(service, session_id, "SESSION_STAGE_CONFLICT", 409)
        if str(exc) == "SESSION_LOCKED":
            return error_response(service, session_id, "SESSION_LOCKED", 409)
        raise


@router.post("/{session_id}/rollback")
def rollback(session_id: str, payload: ConfirmPayload, request: Request):
    service = _service(request)
    try:
        result = service.rollback(session_id, payload.confirm)
        response = {"session_id": session_id, "session_snapshot": result.session_snapshot}
        if result.rollback_precheck is not None:
            response["rollback_precheck"] = result.rollback_precheck
        return response
    except KeyError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    except RuntimeError as exc:
        if str(exc) == "SESSION_STAGE_CONFLICT":
            return error_response(service, session_id, "SESSION_STAGE_CONFLICT", 409)
        if str(exc) == "SESSION_LOCKED":
            return error_response(service, session_id, "SESSION_LOCKED", 409)
        raise
    except ValueError as exc:
        if str(exc) == "confirmation_required":
            raise HTTPException(status_code=400, detail="CONFIRMATION_REQUIRED")
        raise


@router.post("/{session_id}/cleanup-empty-dirs")
def cleanup_empty_dirs(session_id: str, request: Request):
    service = _service(request)
    try:
        return service.cleanup_empty_dirs(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    except RuntimeError:
        return error_response(service, session_id, "SESSION_STAGE_CONFLICT", 409)


@router.post("/{session_id}/rule-drafts")
def generate_rules_from_session(session_id: str, request: Request):
    service = _service(request)
    try:
        return service.generate_rules_from_completed_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    except RuntimeError:
        return error_response(service, session_id, "SESSION_STAGE_CONFLICT", 409)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/{session_id}/journal")
def journal(session_id: str, request: Request):
    try:
        return _service(request).get_journal_summary(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")


@router.get("/{session_id}/events")
def events(session_id: str, request: Request):
    service = _service(request)
    try:
        service.get_snapshot(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")

    def stream():
        snapshot = service.get_snapshot(session_id)
        initial_event = {
            "event_type": "session.snapshot",
            "session_id": session_id,
            "stage": snapshot["stage"],
            "session_snapshot": snapshot,
        }
        yield "event: session.snapshot\n"
        yield f"data: {json.dumps(initial_event, ensure_ascii=False)}\n\n"
        if request_once(request):
            return
        subscriber = service.subscribe(session_id)
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
            service.unsubscribe(session_id, subscriber)

    return StreamingResponse(stream(), media_type="text/event-stream")
