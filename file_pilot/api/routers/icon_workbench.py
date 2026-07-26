"""图标工坊路由。"""

from __future__ import annotations

import json
import logging
from queue import Empty
from typing import TYPE_CHECKING

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse

from file_pilot.api.helpers import request_once
from file_pilot.api.payloads import (
    IconWorkbenchApplyTemplatePayload,
    IconWorkbenchClientActionReportPayload,
    IconWorkbenchConfigPresetCreatePayload,
    IconWorkbenchConfigPresetSwitchPayload,
    IconWorkbenchCreatePayload,
    IconWorkbenchFolderBatchPayload,
    IconWorkbenchPromptPayload,
    IconWorkbenchSelectVersionPayload,
    IconWorkbenchTargetUpdatePayload,
    IconWorkbenchTemplatePayload,
    IconWorkbenchTemplateUpdatePayload,
)

if TYPE_CHECKING:
    from file_pilot.icon_workbench import IconWorkbenchService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/icon-workbench")


def _service(request: Request) -> "IconWorkbenchService":
    return request.app.state.icon_workbench_service


@router.post("/sessions")
def create_icon_workbench_session(payload: IconWorkbenchCreatePayload, request: Request):
    try:
        return _service(request).create_session(payload.target_paths)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/sessions")
def list_icon_workbench_sessions(request: Request):
    return _service(request).list_sessions(limit=20)


@router.get("/sessions/{session_id}")
def get_icon_workbench_session(session_id: str, request: Request):
    try:
        return _service(request).get_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="ICON_SESSION_NOT_FOUND")


@router.delete("/sessions/{session_id}")
def delete_icon_workbench_session(session_id: str, request: Request):
    try:
        return _service(request).delete_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="ICON_SESSION_NOT_FOUND")


@router.get("/sessions/{session_id}/events")
def icon_workbench_events(session_id: str, request: Request):
    service = _service(request)
    try:
        snapshot = service.get_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="ICON_SESSION_NOT_FOUND")

    def stream():
        initial_event = {
            "event_type": "icon.session.snapshot",
            "session_id": session_id,
            "session_snapshot": snapshot,
        }
        yield "event: icon.session.snapshot\n"
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


@router.post("/sessions/{session_id}/scan")
def scan_icon_workbench_session(session_id: str, request: Request):
    try:
        return _service(request).scan_session(session_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="ICON_SESSION_NOT_FOUND")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/sessions/{session_id}/targets")
def update_icon_workbench_targets(session_id: str, payload: IconWorkbenchTargetUpdatePayload, request: Request):
    try:
        return _service(request).update_session_targets(session_id, payload.target_paths, payload.mode)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="ICON_SESSION_NOT_FOUND")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/sessions/{session_id}/targets/{folder_id}")
def remove_icon_workbench_target(session_id: str, folder_id: str, request: Request):
    try:
        return _service(request).remove_session_target(session_id, folder_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="ICON_FOLDER_NOT_FOUND")


@router.post("/sessions/{session_id}/analyze")
def analyze_icon_workbench_session(session_id: str, payload: IconWorkbenchFolderBatchPayload, request: Request):
    try:
        return _service(request).analyze_folders(session_id, payload.folder_ids)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="ICON_FOLDER_NOT_FOUND")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/sessions/{session_id}/generate")
def generate_icon_workbench_previews(session_id: str, payload: IconWorkbenchFolderBatchPayload, request: Request):
    try:
        return _service(request).generate_previews(session_id, payload.folder_ids)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="ICON_FOLDER_NOT_FOUND")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/sessions/{session_id}/folders/{folder_id}/prompt")
def update_icon_workbench_prompt(session_id: str, folder_id: str, payload: IconWorkbenchPromptPayload, request: Request):
    try:
        return _service(request).update_folder_prompt(session_id, folder_id, payload.prompt)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="ICON_FOLDER_NOT_FOUND")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/sessions/{session_id}/folders/{folder_id}/select-version")
def select_icon_workbench_version(
    session_id: str, folder_id: str, payload: IconWorkbenchSelectVersionPayload, request: Request
):
    try:
        return _service(request).select_version(session_id, folder_id, payload.version_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="ICON_VERSION_NOT_FOUND")


@router.delete("/sessions/{session_id}/folders/{folder_id}/versions/{version_id}")
def delete_icon_workbench_version(session_id: str, folder_id: str, version_id: str, request: Request):
    try:
        return _service(request).delete_version(session_id, folder_id, version_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="ICON_VERSION_NOT_FOUND")


@router.get("/sessions/{session_id}/folders/{folder_id}/versions/{version_id}/image")
def get_icon_workbench_image(session_id: str, folder_id: str, version_id: str, request: Request):
    try:
        path = _service(request).get_version_image_path(session_id, folder_id, version_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="ICON_IMAGE_NOT_FOUND")
    return FileResponse(path)


@router.get("/config")
def get_icon_workbench_config(request: Request):
    return _service(request).get_config()


@router.post("/config")
def update_icon_workbench_config(payload: dict, request: Request):
    return _service(request).update_config(payload)


@router.post("/config/presets/switch")
def switch_icon_workbench_config_preset(payload: IconWorkbenchConfigPresetSwitchPayload, request: Request):
    try:
        return _service(request).switch_config_preset(payload.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/config/presets")
def add_icon_workbench_config_preset(payload: IconWorkbenchConfigPresetCreatePayload, request: Request):
    try:
        return _service(request).add_config_preset(payload.name, payload.config)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/config/presets/{preset_id}")
def delete_icon_workbench_config_preset(preset_id: str, request: Request):
    try:
        return _service(request).delete_config_preset(preset_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/templates")
def list_icon_workbench_templates(request: Request):
    return {"templates": _service(request).list_templates()}


@router.post("/templates")
def create_icon_workbench_template(payload: IconWorkbenchTemplatePayload, request: Request):
    try:
        template = _service(request).create_template(payload.model_dump())
        return {"template": template}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/templates/{template_id}")
def update_icon_workbench_template(template_id: str, payload: IconWorkbenchTemplateUpdatePayload, request: Request):
    try:
        template = _service(request).update_template(template_id, payload.model_dump(exclude_none=True))
        return {"template": template}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="ICON_TEMPLATE_NOT_FOUND")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.delete("/templates/{template_id}")
def delete_icon_workbench_template(template_id: str, request: Request):
    try:
        return _service(request).delete_template(template_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="ICON_TEMPLATE_NOT_FOUND")


@router.post("/sessions/{session_id}/apply-template")
def apply_icon_workbench_template(session_id: str, payload: IconWorkbenchApplyTemplatePayload, request: Request):
    try:
        return _service(request).apply_template(session_id, payload.template_id, payload.folder_ids)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="ICON_TEMPLATE_OR_FOLDER_NOT_FOUND")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/sessions/{session_id}/apply-ready")
def prepare_icon_workbench_apply_ready(session_id: str, payload: IconWorkbenchFolderBatchPayload, request: Request):
    try:
        return _service(request).prepare_apply_ready(session_id, payload.folder_ids)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="ICON_FOLDER_NOT_FOUND")


@router.post("/sessions/{session_id}/client-actions/report")
def report_icon_workbench_client_action(
    session_id: str, payload: IconWorkbenchClientActionReportPayload, request: Request
):
    try:
        session = _service(request).report_client_action(session_id, payload.model_dump())
        return {"session": session}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="ICON_SESSION_NOT_FOUND")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/sessions/{session_id}/folders/{folder_id}/versions/{version_id}/add-processed")
async def add_icon_workbench_processed_version(
    session_id: str,
    folder_id: str,
    version_id: str,
    request: Request,
    suffix: str = "processed",
):
    try:
        image_bytes = await request.body()
        if not image_bytes:
            raise HTTPException(status_code=400, detail="EMPTY_IMAGE_DATA")

        session = _service(request).add_processed_version(
            session_id,
            folder_id,
            version_id,
            image_bytes,
            suffix=suffix,
        )
        return {"session": session}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="ICON_ENTITY_NOT_FOUND")
    except Exception as exc:
        logger.exception("Register processed version failed")
        raise HTTPException(status_code=500, detail=str(exc))
