"""目标目录档案路由。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from file_pilot.api.payloads import (
    CreateTargetProfilePayload,
    GenerateRuleDraftsPayload,
    UpdateTargetProfilePayload,
)

router = APIRouter(prefix="/api/target-profiles")


@router.get("")
def list_target_profiles(request: Request):
    return {"items": request.app.state.service.list_target_profiles()}


@router.post("")
def create_target_profile(payload: CreateTargetProfilePayload, request: Request):
    try:
        profile = request.app.state.service.create_target_profile(
            payload.name,
            [item.model_dump() for item in payload.directories],
        )
        return {"item": profile}
    except ValueError as exc:
        if str(exc) == "TARGET_PROFILE_NAME_REQUIRED":
            return JSONResponse(status_code=400, content={"error_code": str(exc)})
        raise


@router.patch("/{profile_id}")
def update_target_profile(profile_id: str, payload: UpdateTargetProfilePayload, request: Request):
    try:
        profile = request.app.state.service.update_target_profile(
            profile_id,
            name=payload.name,
            directories=([item.model_dump() for item in payload.directories] if payload.directories is not None else None),
        )
        return {"item": profile}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="TARGET_PROFILE_NOT_FOUND")


@router.post("/{profile_id}/rule-drafts")
def generate_rule_drafts(
    profile_id: str,
    request: Request,
    payload: GenerateRuleDraftsPayload | None = None,
):
    from file_pilot.organize.rule_advisor import classify_rule_draft_error

    paths = payload.paths if payload is not None else None
    try:
        return request.app.state.service.generate_target_profile_rule_drafts(profile_id, paths=paths)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="TARGET_PROFILE_NOT_FOUND")
    except ValueError as exc:
        if str(exc) == "RULE_DRAFTS_PATHS_NOT_IN_PROFILE":
            return JSONResponse(
                status_code=400,
                content={
                    "error_code": "RULE_DRAFTS_PATHS_NOT_IN_PROFILE",
                    "detail": "RULE_DRAFTS_PATHS_NOT_IN_PROFILE",
                    "message": "指定的目录不在当前规则配置中。",
                },
            )
        code, message = classify_rule_draft_error(exc)
        return JSONResponse(status_code=502, content={"error_code": code, "detail": code, "message": message})
    except Exception as exc:
        code, message = classify_rule_draft_error(exc)
        return JSONResponse(status_code=502, content={"error_code": code, "detail": code, "message": message})


@router.delete("/{profile_id}")
def delete_target_profile(profile_id: str, request: Request):
    if not request.app.state.service.delete_target_profile(profile_id):
        raise HTTPException(status_code=404, detail="TARGET_PROFILE_NOT_FOUND")
    return {"status": "deleted", "profile_id": profile_id}
