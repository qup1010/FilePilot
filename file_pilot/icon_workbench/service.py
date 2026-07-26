from __future__ import annotations

import logging
import os
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from queue import Queue
from threading import Lock

from file_pilot.icon_workbench.client import (
    IconWorkbenchImageClient,
    IconWorkbenchTextClient,
    scan_folder_tree,
)
from file_pilot.icon_workbench.models import (
    FolderIconCandidate,
    IconPreviewVersion,
    IconTemplate,
    IconWorkbenchClientActionSummary,
    IconWorkbenchSession,
    utc_now_iso,
)
from file_pilot.icon_workbench.store import IconWorkbenchStore
from file_pilot.icon_workbench.templates import render_prompt_template
from file_pilot.shared.config_manager import config_manager

logger = logging.getLogger(__name__)


class IconWorkbenchService:
    MISSING_TARGET_ERROR = "目标文件夹不存在。"

    def __init__(
        self,
        store: IconWorkbenchStore | None = None,
        text_client: IconWorkbenchTextClient | None = None,
        image_client: IconWorkbenchImageClient | None = None,
    ):
        project_root = Path(__file__).resolve().parents[2]
        root = project_root / "output" / "icon_workbench"
        self.store = store or IconWorkbenchStore(root, settings_service=config_manager.service)
        self.text_client = text_client or IconWorkbenchTextClient()
        self.image_client = image_client or IconWorkbenchImageClient()
        self._event_log: dict[str, list[dict]] = {}
        self._subscribers: dict[str, list[Queue]] = {}
        self._event_lock = Lock()
        self._session_locks: dict[str, Lock] = {}

    def create_session(self, target_paths: list[str]) -> dict:
        normalized_paths = self._normalize_target_paths(target_paths)
        session = IconWorkbenchSession(
            session_id=uuid.uuid4().hex,
            target_paths=normalized_paths,
            folders=self._build_folders_for_targets(normalized_paths),
        )
        self.store.remove_session_assets(session.session_id)
        self.store.save_session(session)
        self._log_runtime_event("session.created", session, target_count=len(session.folders))
        self._record_event("icon.session.created", session)
        return self._serialize_session(session)

    def get_session(self, session_id: str) -> dict:
        session = self.store.load_session(session_id)
        return self._serialize_session(session)

    def list_sessions(self, limit: int = 20) -> dict:
        try:
            parsed_limit = int(limit or 20)
        except (TypeError, ValueError):
            parsed_limit = 20
        safe_limit = max(1, min(parsed_limit, 100))
        sessions = self.store.list_sessions()[:safe_limit]
        return {"sessions": [self._serialize_session_history_item(session) for session in sessions]}

    def delete_session(self, session_id: str) -> dict:
        deleted = self.store.delete_session(session_id)
        if not deleted:
            raise FileNotFoundError(session_id)
        with self._event_lock:
            self._event_log.pop(session_id, None)
            self._subscribers.pop(session_id, None)
            self._session_locks.pop(session_id, None)
        return {"status": "deleted", "session_id": session_id}

    def scan_session(self, session_id: str) -> dict:
        session = self.store.load_session(session_id)
        session.folders = self._build_folders_for_targets(session.target_paths, session.folders)
        session.updated_at = utc_now_iso()
        self.store.save_session(session)
        return self._serialize_session(session)

    def update_session_targets(self, session_id: str, target_paths: list[str], mode: str = "append") -> dict:
        with self._get_session_lock(session_id):
            session = self.store.load_session(session_id)
            normalized_mode = str(mode or "append").strip().lower()
            normalized_paths = self._normalize_target_paths(target_paths, allow_empty=(normalized_mode == "replace"))
            if normalized_mode not in {"append", "replace"}:
                raise ValueError("不支持的目标更新模式。")

            current_paths = list(session.target_paths) if normalized_mode == "append" else []
            next_paths = self._merge_target_paths(current_paths, normalized_paths)
            removed_ids = self._collect_removed_folder_ids(session, next_paths)

            session.target_paths = next_paths
            session.folders = self._build_folders_for_targets(next_paths, session.folders)
            session.updated_at = utc_now_iso()
            self.store.save_session(session)
        for folder_id in removed_ids:
            self.store.remove_folder_assets(session.session_id, folder_id)
        self._record_event("icon.targets.updated", session, mode=normalized_mode, removed_ids=removed_ids)
        return self._serialize_session(session)

    def remove_session_target(self, session_id: str, folder_id: str) -> dict:
        with self._get_session_lock(session_id):
            session = self.store.load_session(session_id)
            folder = self._get_folder(session, folder_id)
            removed_path = folder.folder_path.lower()

            session.target_paths = [path for path in session.target_paths if path.lower() != removed_path]
            session.folders = [item for item in session.folders if item.folder_id != folder_id]
            session.updated_at = utc_now_iso()
            self.store.save_session(session)
        self.store.remove_folder_assets(session.session_id, folder_id)
        self._record_event("icon.targets.updated", session, mode="remove", removed_ids=[folder_id])
        return self._serialize_session(session)

    def analyze_folders(self, session_id: str, folder_ids: list[str] | None = None) -> dict:
        session = self.store.load_session(session_id)
        config = self.store.config_store.load()
        if not config.text_model.is_configured():
            raise ValueError("请先在全局设置中填写文本模型接口地址、模型 ID 和 API 密钥。")

        targets = self._resolve_target_folders(session, folder_ids)
        total_targets = len(targets)
        for folder in targets:
            folder.analysis_status = "analyzing"
            folder.last_error = None
            folder.updated_at = utc_now_iso()
        session.updated_at = utc_now_iso()
        self.store.save_session(session)
        self._log_runtime_event("analysis.started", session, total=total_targets)
        self._record_event(
            "icon.analysis.started",
            session,
            progress=self._build_progress_payload("analyzing", total_targets, 0),
        )

        completed = 0
        for folder, outcome in self._iter_folder_jobs(
            targets,
            max_workers=config.analysis_concurrency_limit,
            worker=self._analyze_folder_job,
            config=config,
        ):
            if outcome["status"] == "ok":
                analysis = outcome["analysis"]
                previous_suggestion = folder.analysis.suggested_prompt if folder.analysis else ""
                folder.analysis = analysis
                folder.analysis_status = "ready"
                folder.last_error = None
                if not folder.prompt_customized or folder.current_prompt in {"", previous_suggestion}:
                    folder.current_prompt = analysis.suggested_prompt
                    folder.prompt_customized = False
            else:
                folder.analysis_status = "error"
                folder.last_error = outcome["error"]
            folder.updated_at = utc_now_iso()
            completed += 1
            session.updated_at = utc_now_iso()
            self.store.save_session(session)
            self._log_runtime_event(
                "analysis.progress",
                session,
                completed=completed,
                total=total_targets,
                folder_name=folder.folder_name,
                status=folder.analysis_status,
            )
            self._record_event(
                "icon.analysis.progress",
                session,
                progress=self._build_progress_payload(
                    "analyzing",
                    total_targets,
                    completed,
                    current_folder=folder,
                ),
                folder_id=folder.folder_id,
                status=folder.analysis_status,
            )

        session.updated_at = utc_now_iso()
        self.store.save_session(session)
        self._log_runtime_event("analysis.completed", session, total=total_targets)
        self._record_event(
            "icon.analysis.completed",
            session,
            progress=self._build_progress_payload("analyzing", total_targets, total_targets),
        )
        return self._serialize_session(session)

    def update_folder_prompt(self, session_id: str, folder_id: str, prompt: str) -> dict:
        session = self.store.load_session(session_id)
        folder = self._get_folder(session, folder_id)
        next_prompt = str(prompt or "").strip()
        if not next_prompt:
            raise ValueError("提示词不能为空。")

        folder.current_prompt = next_prompt
        folder.prompt_customized = True
        folder.last_error = None
        folder.updated_at = utc_now_iso()
        session.updated_at = utc_now_iso()
        self.store.save_session(session)
        return self._serialize_session(session)

    def generate_previews(self, session_id: str, folder_ids: list[str] | None = None) -> dict:
        session = self.store.load_session(session_id)
        config = self.store.config_store.load()
        if not config.image_model.is_configured():
            raise ValueError("请先在全局设置中填写图标工坊的图像生成接口地址、模型 ID 和 API 密钥。")

        targets = self._resolve_target_folders(session, folder_ids)
        prepared_targets: list[FolderIconCandidate] = []
        total_targets = len(targets)
        for folder in targets:
            prompt = folder.current_prompt.strip() or (folder.analysis.suggested_prompt if folder.analysis else "")
            if not prompt:
                folder.last_error = "请先分析文件夹或手动填写提示词。"
                folder.updated_at = utc_now_iso()
                continue

            version_number = len(folder.versions) + 1
            version_id = uuid.uuid4().hex
            image_path = self.store.preview_directory(session.session_id, folder.folder_id) / f"v{version_number}.png"
            folder.versions.append(
                IconPreviewVersion(
                    version_id=version_id,
                    version_number=version_number,
                    prompt=prompt,
                    image_path=str(image_path.resolve()),
                    status="generating",
                )
            )
            folder.current_version_id = version_id
            folder.last_error = None
            folder.updated_at = utc_now_iso()
            prepared_targets.append(folder)

        session.updated_at = utc_now_iso()
        self.store.save_session(session)
        self._log_runtime_event(
            "generation.started",
            session,
            total=total_targets,
            runnable=len(prepared_targets),
        )
        self._record_event(
            "icon.generation.started",
            session,
            progress=self._build_progress_payload("generating", len(prepared_targets), 0),
        )

        completed = 0
        for folder, outcome in self._iter_folder_jobs(
            prepared_targets,
            max_workers=config.image_concurrency_limit,
            worker=self._generate_preview_job,
            config=config,
        ):
            target_version = next((item for item in folder.versions if item.version_id == folder.current_version_id), None)
            if not target_version:
                continue

            if outcome["status"] == "ok":
                target_version.status = "ready"
                target_version.error_message = None
                folder.last_error = None
            else:
                target_version.status = "error"
                target_version.error_message = outcome["error"]
                folder.last_error = outcome["error"]
            folder.updated_at = utc_now_iso()
            completed += 1
            session.updated_at = utc_now_iso()
            self.store.save_session(session)
            self._log_runtime_event(
                "generation.progress",
                session,
                completed=completed,
                total=total_targets,
                folder_name=folder.folder_name,
                status=target_version.status,
            )
            self._record_event(
                "icon.generation.progress",
                session,
                progress=self._build_progress_payload(
                    "generating",
                    len(prepared_targets),
                    completed,
                    current_folder=folder,
                ),
                folder_id=folder.folder_id,
                status=target_version.status,
            )

        session.updated_at = utc_now_iso()
        self.store.save_session(session)
        self._log_runtime_event("generation.completed", session, total=total_targets)
        self._record_event(
            "icon.generation.completed",
            session,
            progress=self._build_progress_payload("generating", len(prepared_targets), len(prepared_targets)),
        )
        return self._serialize_session(session)

    def add_processed_version(
        self,
        session_id: str,
        folder_id: str,
        original_version_id: str,
        image_bytes: bytes,
        suffix: str = "processed",
    ) -> dict:
        with self._get_session_lock(session_id):
            session = self.store.load_session(session_id)
            folder = self._get_folder(session, folder_id)
            original = next(
                (v for v in folder.versions if v.version_id == original_version_id),
                None,
            )
            if not original:
                raise FileNotFoundError(f"Original version {original_version_id} not found")

            version_number = len(folder.versions) + 1
            version_id = uuid.uuid4().hex
            filename = f"v{version_number}_{suffix}.png" if suffix else f"v{version_number}.png"
            image_path = self.store.preview_directory(session.session_id, folder.folder_id) / filename

            image_path.write_bytes(image_bytes)

            version = IconPreviewVersion(
                version_id=version_id,
                version_number=version_number,
                prompt=original.prompt,
                image_path=str(image_path.resolve()),
                status="ready",
            )
            folder.versions.append(version)
            folder.current_version_id = version.version_id
            folder.updated_at = utc_now_iso()
            session.updated_at = utc_now_iso()
            self.store.save_session(session)
            return self._serialize_session(session)

    def select_version(self, session_id: str, folder_id: str, version_id: str) -> dict:
        session = self.store.load_session(session_id)
        folder = self._get_folder(session, folder_id)
        if not any(version.version_id == version_id for version in folder.versions):
            raise FileNotFoundError(version_id)
        folder.current_version_id = version_id
        folder.updated_at = utc_now_iso()
        session.updated_at = utc_now_iso()
        self.store.save_session(session)
        return self._serialize_session(session)

    def get_version_image_path(self, session_id: str, folder_id: str, version_id: str) -> Path:
        session = self.store.load_session(session_id)
        folder = self._get_folder(session, folder_id)
        for version in folder.versions:
            if version.version_id == version_id:
                path = Path(version.image_path)
                if not path.exists():
                    raise FileNotFoundError(version.image_path)
                return path
        raise FileNotFoundError(version_id)

    def delete_version(self, session_id: str, folder_id: str, version_id: str) -> dict:
        session = self.store.load_session(session_id)
        folder = self._get_folder(session, folder_id)
        target_version = next((version for version in folder.versions if version.version_id == version_id), None)
        if not target_version:
            raise FileNotFoundError(version_id)

        folder.versions = [version for version in folder.versions if version.version_id != version_id]
        if folder.current_version_id == version_id:
            ready_versions = [version for version in folder.versions if version.status == "ready"]
            folder.current_version_id = (
                max(ready_versions, key=lambda version: version.version_number).version_id if ready_versions else None
            )
        if folder.applied_version_id == version_id:
            folder.applied_version_id = None
            folder.applied_at = None
        image_path = Path(target_version.image_path)
        try:
            if image_path.exists():
                image_path.unlink()
        except OSError:
            logger.warning("icon_workbench.version.delete_file_failed path=%s", image_path, exc_info=True)

        folder.updated_at = utc_now_iso()
        session.updated_at = utc_now_iso()
        self.store.save_session(session)
        self._log_runtime_event(
            "version.deleted",
            session,
            folder_name=folder.folder_name,
            version_id=version_id,
        )
        self._record_event("icon.version.deleted", session, folder_id=folder_id, version_id=version_id)
        return self._serialize_session(session)

    def get_config(self) -> dict:
        return self.store.config_store.get_payload()

    def update_config(self, payload: dict) -> dict:
        self.store.config_store.update(payload)
        return self.store.config_store.get_payload()["config"]

    def switch_config_preset(self, preset_id: str) -> dict:
        return self.store.config_store.switch_preset(preset_id)

    def add_config_preset(self, name: str, config_patch: dict | None = None) -> dict:
        return self.store.config_store.add_preset(name, copy_from_active=True, config_patch=config_patch)

    def delete_config_preset(self, preset_id: str) -> dict:
        return self.store.config_store.delete_preset(preset_id)

    def report_client_action(self, session_id: str, payload: dict) -> dict:
        session = self.store.load_session(session_id)
        action_type = str(payload.get("action_type", "") or "").strip()
        results = payload.get("results", []) or []
        skipped_items = payload.get("skipped_items", []) or []

        success_statuses = {"applied", "restored"}
        success_count = sum(1 for item in results if str(item.get("status", "") or "") in success_statuses)
        failed_count = max(0, len(results) - success_count)
        skipped_count = len(skipped_items)
        action_label = "应用图标" if action_type == "apply_icons" else "恢复图标"

        folders_by_id = {folder.folder_id: folder for folder in session.folders}
        for item in results:
            folder_id = str(item.get("folder_id", "") or "").strip()
            if not folder_id:
                continue
            folder = folders_by_id.get(folder_id)
            if not folder:
                continue
            status = str(item.get("status", "") or "").strip().lower()
            if action_type == "apply_icons" and status == "applied":
                version_id = str(item.get("version_id", "") or "").strip()
                if version_id:
                    folder.applied_version_id = version_id
                    folder.applied_at = utc_now_iso()
                    folder.updated_at = utc_now_iso()
            if action_type == "restore_icons" and status == "restored":
                folder.applied_version_id = None
                folder.applied_at = None
                folder.updated_at = utc_now_iso()

        content = f"{action_label}已完成：成功 {success_count}，失败 {failed_count}，跳过 {skipped_count}。"
        session.last_client_action = IconWorkbenchClientActionSummary(
            action_type=action_type or "client_action",
            success_count=success_count,
            failed_count=failed_count,
            skipped_count=skipped_count,
            message=content,
            results=[dict(item) for item in [*results, *skipped_items]],
        )
        session.updated_at = utc_now_iso()
        self.store.save_session(session)
        return self._serialize_session(session)

    def list_templates(self) -> list[dict]:
        return [template.to_dict() for template in self.store.load_templates()]

    def create_template(self, payload: dict) -> dict:
        name = str(payload.get("name", "") or "").strip()
        description = str(payload.get("description", "") or "").strip()
        prompt_template = str(payload.get("prompt_template", "") or "").strip()
        if not name:
            raise ValueError("模板名称不能为空。")
        if not prompt_template:
            raise ValueError("模板提示词不能为空。")

        all_templates = self.store.load_templates()
        if any(template.name.lower() == name.lower() for template in all_templates):
            raise ValueError("已存在同名模板。")

        users = [template for template in all_templates if not template.is_builtin]
        new_template = IconTemplate(
            template_id=uuid.uuid4().hex,
            name=name,
            description=description,
            prompt_template=prompt_template,
            is_builtin=False,
        )
        users.append(new_template)
        self.store.save_user_templates(users)
        return new_template.to_dict()

    def update_template(self, template_id: str, payload: dict) -> dict:
        all_templates = self.store.load_templates()
        users = [template for template in all_templates if not template.is_builtin]
        target = next((template for template in users if template.template_id == template_id), None)
        if not target:
            raise FileNotFoundError(template_id)

        if "name" in payload:
            next_name = str(payload.get("name", "") or "").strip()
            if not next_name:
                raise ValueError("模板名称不能为空。")
            if any(
                template.template_id != template_id and template.name.lower() == next_name.lower()
                for template in all_templates
            ):
                raise ValueError("已存在同名模板。")
            target.name = next_name
        if "description" in payload:
            target.description = str(payload.get("description", "") or "").strip()
        if "prompt_template" in payload:
            next_prompt = str(payload.get("prompt_template", "") or "").strip()
            if not next_prompt:
                raise ValueError("模板提示词不能为空。")
            target.prompt_template = next_prompt
        target.updated_at = utc_now_iso()
        self.store.save_user_templates(users)
        return target.to_dict()

    def delete_template(self, template_id: str) -> dict:
        all_templates = self.store.load_templates()
        users = [template for template in all_templates if not template.is_builtin]
        remaining = [template for template in users if template.template_id != template_id]
        if len(remaining) == len(users):
            raise FileNotFoundError(template_id)
        self.store.save_user_templates(remaining)
        return {"status": "ok", "template_id": template_id}

    def apply_template(self, session_id: str, template_id: str, folder_ids: list[str] | None = None) -> dict:
        session = self.store.load_session(session_id)
        templates = self.store.load_templates()
        template = next((item for item in templates if item.template_id == template_id), None)
        if not template:
            raise FileNotFoundError(template_id)

        targets = self._resolve_target_folders(session, folder_ids)
        for folder in targets:
            analysis = folder.analysis
            next_prompt = render_prompt_template(
                template.prompt_template,
                folder_name=folder.folder_name,
                category=analysis.category if analysis else "",
                subject=(analysis.visual_subject if analysis else "") or folder.folder_name,
            )
            folder.current_prompt = next_prompt
            folder.prompt_customized = True
            folder.last_error = None
            folder.updated_at = utc_now_iso()

        session.updated_at = utc_now_iso()
        self.store.save_session(session)
        result = self._serialize_session(session)
        result["template_id"] = template_id
        result["template_name"] = template.name
        return result

    def prepare_apply_ready(self, session_id: str, folder_ids: list[str] | None = None) -> dict:
        session = self.store.load_session(session_id)
        config = self.store.config_store.load()
        targets = self._resolve_target_folders(session, folder_ids)

        tasks: list[dict] = []
        skipped_items: list[dict] = []
        for folder in targets:
            if not folder.current_version_id:
                skipped_items.append(
                    {
                        "folder_id": folder.folder_id,
                        "folder_name": folder.folder_name,
                        "status": "skipped",
                        "message": "未选择当前版本",
                    }
                )
                continue

            current = next(
                (version for version in folder.versions if version.version_id == folder.current_version_id),
                None,
            )
            if not current or current.status != "ready":
                skipped_items.append(
                    {
                        "folder_id": folder.folder_id,
                        "folder_name": folder.folder_name,
                        "status": "skipped",
                        "message": "当前版本未就绪",
                    }
                )
                continue
            tasks.append(
                {
                    "folder_id": folder.folder_id,
                    "folder_name": folder.folder_name,
                    "folder_path": folder.folder_path,
                    "version_id": current.version_id,
                    "image_path": current.image_path,
                    "save_mode": config.save_mode,
                }
            )

        return {
            "session_id": session_id,
            "total": len(targets),
            "ready_count": len(tasks),
            "skipped_count": len(skipped_items),
            "tasks": tasks,
            "skipped_items": skipped_items,
        }

    def _normalize_directory(self, path: str) -> str:
        normalized = os.path.abspath(str(path or "").strip())
        if not normalized or not os.path.isdir(normalized):
            raise ValueError("目标文件夹不存在。")
        return normalized

    def _normalize_target_paths(self, target_paths: list[str] | None, allow_empty: bool = False) -> list[str]:
        if not target_paths:
            if allow_empty:
                return []
            raise ValueError("至少选择 1 个目标文件夹。")

        normalized_paths: list[str] = []
        seen: set[str] = set()
        for path in target_paths:
            normalized = self._normalize_directory(path)
            key = normalized.lower()
            if key in seen:
                continue
            seen.add(key)
            normalized_paths.append(normalized)
        return normalized_paths

    def _merge_target_paths(self, current_paths: list[str], incoming_paths: list[str]) -> list[str]:
        merged: list[str] = []
        seen: set[str] = set()
        for path in [*current_paths, *incoming_paths]:
            normalized = os.path.abspath(str(path or "").strip())
            if not normalized:
                continue
            key = normalized.lower()
            if key in seen:
                continue
            seen.add(key)
            merged.append(normalized)
        return merged

    def _build_folders_for_targets(
        self,
        target_paths: list[str],
        existing_folders: list[FolderIconCandidate] | None = None,
    ) -> list[FolderIconCandidate]:
        existing_by_path = {
            os.path.abspath(item.folder_path).lower(): item
            for item in (existing_folders or [])
            if item.folder_path
        }
        folders: list[FolderIconCandidate] = []
        for target_path in target_paths:
            normalized_path = os.path.abspath(str(target_path or "").strip())
            existing = existing_by_path.get(normalized_path.lower())
            folder_name = Path(normalized_path).name or normalized_path
            if existing:
                existing.folder_path = normalized_path
                existing.folder_name = folder_name
                if os.path.isdir(normalized_path):
                    if existing.last_error == self.MISSING_TARGET_ERROR:
                        existing.last_error = None
                else:
                    existing.last_error = self.MISSING_TARGET_ERROR
                existing.updated_at = utc_now_iso()
                folders.append(existing)
                continue

            folder = FolderIconCandidate(
                folder_id=uuid.uuid4().hex,
                folder_path=normalized_path,
                folder_name=folder_name,
            )
            if not os.path.isdir(normalized_path):
                folder.last_error = self.MISSING_TARGET_ERROR
            folders.append(folder)
        return folders

    def _collect_removed_folder_ids(self, session: IconWorkbenchSession, next_paths: list[str]) -> list[str]:
        next_path_set = {os.path.abspath(path).lower() for path in next_paths}
        return [
            folder.folder_id
            for folder in session.folders
            if os.path.abspath(folder.folder_path).lower() not in next_path_set
        ]

    def _iter_folder_jobs(
        self,
        folders: list[FolderIconCandidate],
        *,
        max_workers: int,
        worker,
        **worker_kwargs,
    ):
        if not folders:
            return

        worker_count = max(1, min(int(max_workers or 1), len(folders)))
        if worker_count == 1:
            for folder in folders:
                yield folder, worker(folder, **worker_kwargs)
            return

        with ThreadPoolExecutor(max_workers=worker_count) as executor:
            futures = {
                executor.submit(worker, folder, **worker_kwargs): folder
                for folder in folders
            }
            for future in as_completed(futures):
                folder = futures[future]
                yield folder, future.result()

    def _analyze_folder_job(self, folder: FolderIconCandidate, *, config) -> dict:
        try:
            tree_lines = scan_folder_tree(folder.folder_path, max_depth=2)
            analysis = self.text_client.analyze_folder(
                config.text_model,
                folder.folder_path,
                folder.folder_name,
                tree_lines,
            )
            return {"status": "ok", "analysis": analysis}
        except Exception as exc:
            return {"status": "error", "error": str(exc)}

    def _generate_preview_job(self, folder: FolderIconCandidate, *, config) -> dict:
        prompt = folder.current_prompt.strip() or (folder.analysis.suggested_prompt if folder.analysis else "")
        if not prompt:
            return {"status": "missing_prompt"}
        target_version = next((item for item in folder.versions if item.version_id == folder.current_version_id), None)
        if not target_version:
            return {"status": "error", "error": "图标版本初始化失败"}
        image_path = Path(target_version.image_path)
        try:
            image_bytes = self.image_client.generate_png(config.image_model, prompt, config.image_size)
            image_path.write_bytes(image_bytes)
            return {"status": "ok"}
        except Exception as exc:
            return {"status": "error", "error": str(exc)}

    def _resolve_target_folders(
        self,
        session: IconWorkbenchSession,
        folder_ids: list[str] | None,
    ) -> list[FolderIconCandidate]:
        if not folder_ids:
            return list(session.folders)
        folder_id_set = {str(folder_id) for folder_id in folder_ids}
        targets = [folder for folder in session.folders if folder.folder_id in folder_id_set]
        if not targets:
            raise FileNotFoundError("folder_ids")
        return targets

    def _get_folder(self, session: IconWorkbenchSession, folder_id: str) -> FolderIconCandidate:
        for folder in session.folders:
            if folder.folder_id == folder_id:
                return folder
        raise FileNotFoundError(folder_id)

    def _serialize_session(self, session: IconWorkbenchSession) -> dict:
        payload = session.to_dict()
        for folder in payload["folders"]:
            for version in folder["versions"]:
                version["image_url"] = (
                    f"/api/icon-workbench/sessions/{session.session_id}/folders/"
                    f"{folder['folder_id']}/versions/{version['version_id']}/image"
                )
        payload["folder_count"] = len(payload["folders"])
        payload["ready_count"] = sum(
            1
            for folder in payload["folders"]
            if folder["current_version_id"]
            and any(
                version["version_id"] == folder["current_version_id"] and version["status"] == "ready"
                for version in folder["versions"]
            )
        )
        return payload

    def _serialize_session_history_item(self, session: IconWorkbenchSession) -> dict:
        ready_version_count = sum(
            1
            for folder in session.folders
            for version in folder.versions
            if version.status == "ready"
        )
        error_count = sum(
            1
            for folder in session.folders
            if folder.last_error
            or folder.analysis_status == "error"
            or any(version.status == "error" for version in folder.versions)
        )
        last_action = session.last_client_action
        return {
            "session_id": session.session_id,
            "created_at": session.created_at,
            "updated_at": session.updated_at,
            "target_count": len(session.target_paths),
            "folder_count": len(session.folders),
            "ready_count": ready_version_count,
            "applied_count": sum(1 for folder in session.folders if folder.applied_version_id),
            "error_count": error_count,
            "target_paths": list(session.target_paths[:2]),
            "last_action_type": last_action.action_type if last_action else None,
            "last_action_message": last_action.message if last_action else None,
            "last_action_at": last_action.updated_at if last_action else None,
        }

    def subscribe(self, session_id: str) -> Queue:
        subscriber: Queue = Queue()
        with self._event_lock:
            self._subscribers.setdefault(session_id, []).append(subscriber)
        return subscriber

    def unsubscribe(self, session_id: str, subscriber: Queue) -> None:
        with self._event_lock:
            current = self._subscribers.get(session_id, [])
            self._subscribers[session_id] = [item for item in current if item is not subscriber]
            if not self._subscribers[session_id]:
                self._subscribers.pop(session_id, None)

    def _build_progress_payload(
        self,
        stage: str,
        total_folders: int,
        completed_folders: int,
        current_folder: FolderIconCandidate | None = None,
    ) -> dict:
        return {
            "stage": stage,
            "totalFolders": max(0, total_folders),
            "completedFolders": max(0, completed_folders),
            "currentFolderId": current_folder.folder_id if current_folder else None,
            "currentFolderName": current_folder.folder_name if current_folder else None,
        }

    def _get_session_lock(self, session_id: str) -> Lock:
        with self._event_lock:
            lock = self._session_locks.get(session_id)
            if lock is None:
                lock = Lock()
                self._session_locks[session_id] = lock
            return lock

    def _log_runtime_event(self, event_type: str, session: IconWorkbenchSession, **payload) -> None:
        extras = " ".join(f"{key}={value}" for key, value in payload.items() if value not in {None, ""})
        suffix = f" {extras}" if extras else ""
        logger.info(
            "icon_workbench.%s session_id=%s target_count=%s%s",
            event_type,
            session.session_id,
            len(session.folders),
            suffix,
        )

    def _record_event(self, event_type: str, session: IconWorkbenchSession, **kwargs) -> None:
        event = {
            "event_type": event_type,
            "session_id": session.session_id,
            "session_snapshot": self._serialize_session(session),
            **kwargs,
        }
        with self._event_lock:
            self._event_log.setdefault(session.session_id, []).append(event)
            subscribers = list(self._subscribers.get(session.session_id, []))
        for subscriber in subscribers:
            subscriber.put(event)
