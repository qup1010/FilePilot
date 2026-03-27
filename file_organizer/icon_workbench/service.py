from __future__ import annotations

import os
import uuid
from pathlib import Path

from file_organizer.icon_workbench.chat_agent import IconWorkbenchChatAgent
from file_organizer.icon_workbench.client import (
    IconWorkbenchImageClient,
    IconWorkbenchTextClient,
    scan_folder_tree,
)
from file_organizer.icon_workbench.models import (
    FolderIconCandidate,
    IconTemplate,
    IconWorkbenchChatMessage,
    IconWorkbenchPendingAction,
    IconPreviewVersion,
    IconWorkbenchSession,
    IconWorkbenchToolResult,
    utc_now_iso,
)
from file_organizer.icon_workbench.store import IconWorkbenchStore
from file_organizer.icon_workbench.templates import render_prompt_template


class IconWorkbenchService:
    def __init__(
        self,
        store: IconWorkbenchStore | None = None,
        text_client: IconWorkbenchTextClient | None = None,
        image_client: IconWorkbenchImageClient | None = None,
        chat_agent: IconWorkbenchChatAgent | None = None,
    ):
        project_root = Path(__file__).resolve().parents[2]
        root = project_root / "output" / "icon_workbench"
        self.store = store or IconWorkbenchStore(root)
        self.text_client = text_client or IconWorkbenchTextClient()
        self.image_client = image_client or IconWorkbenchImageClient()
        self.chat_agent = chat_agent or IconWorkbenchChatAgent(self.text_client)

    def create_session(self, parent_dir: str) -> dict:
        normalized_dir = self._normalize_directory(parent_dir)
        session = IconWorkbenchSession(
            session_id=uuid.uuid4().hex,
            parent_dir=normalized_dir,
        )
        self._append_session_message(
            session,
            role="assistant",
            content="图标工坊会话已建立。你可以让我分析选中的文件夹、套用模板、改提示词，或在确认后生成并应用图标。",
        )
        self.store.remove_session_assets(session.session_id)
        self.store.save_session(session)
        return self.scan_session(session.session_id)

    def get_session(self, session_id: str) -> dict:
        session = self.store.load_session(session_id)
        return self._serialize_session(session)

    def scan_session(self, session_id: str) -> dict:
        session = self.store.load_session(session_id)
        existing_by_path = {item.folder_path.lower(): item for item in session.folders}

        folders: list[FolderIconCandidate] = []
        for folder_path in self._list_immediate_subfolders(session.parent_dir):
            existing = existing_by_path.get(folder_path.lower())
            folder_name = Path(folder_path).name or folder_path
            if existing:
                existing.folder_name = folder_name
                existing.updated_at = utc_now_iso()
                folders.append(existing)
                continue

            folders.append(
                FolderIconCandidate(
                    folder_id=uuid.uuid4().hex,
                    folder_path=folder_path,
                    folder_name=folder_name,
                )
            )

        session.folders = folders
        session.updated_at = utc_now_iso()
        self.store.save_session(session)
        return self._serialize_session(session)

    def analyze_folders(self, session_id: str, folder_ids: list[str] | None = None) -> dict:
        session = self.store.load_session(session_id)
        config = self.store.config_store.load()
        if not config.text_model.is_configured():
            raise ValueError("请先在图标工坊设置中填写文本模型接口地址、模型 ID 和 API 密钥。")

        targets = self._resolve_target_folders(session, folder_ids)
        for folder in targets:
            try:
                tree_lines = scan_folder_tree(folder.folder_path, max_depth=2)
                analysis = self.text_client.analyze_folder(config.text_model, folder.folder_name, tree_lines)
                previous_suggestion = folder.analysis.suggested_prompt if folder.analysis else ""
                folder.analysis = analysis
                folder.analysis_status = "ready"
                folder.last_error = None
                if not folder.prompt_customized or folder.current_prompt in {"", previous_suggestion}:
                    folder.current_prompt = analysis.suggested_prompt
                    folder.prompt_customized = False
            except Exception as exc:
                folder.analysis_status = "error"
                folder.last_error = str(exc)
            finally:
                folder.updated_at = utc_now_iso()

        session.updated_at = utc_now_iso()
        self.store.save_session(session)
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
            raise ValueError("请先在图标工坊设置中填写图像生成接口地址、模型 ID 和 API 密钥。")

        targets = self._resolve_target_folders(session, folder_ids)
        for folder in targets:
            prompt = folder.current_prompt.strip() or (folder.analysis.suggested_prompt if folder.analysis else "")
            if not prompt:
                folder.last_error = "请先分析文件夹或手动填写提示词。"
                folder.updated_at = utc_now_iso()
                continue

            version_number = len(folder.versions) + 1
            version_id = uuid.uuid4().hex
            image_path = self.store.preview_directory(session.session_id, folder.folder_id) / f"v{version_number}.png"
            try:
                image_bytes = self.image_client.generate_png(config.image_model, prompt, config.image_size)
                image_path.write_bytes(image_bytes)
                version = IconPreviewVersion(
                    version_id=version_id,
                    version_number=version_number,
                    prompt=prompt,
                    image_path=str(image_path.resolve()),
                    status="ready",
                )
                folder.versions.append(version)
                folder.current_version_id = version.version_id
                folder.last_error = None
            except Exception as exc:
                folder.versions.append(
                    IconPreviewVersion(
                        version_id=version_id,
                        version_number=version_number,
                        prompt=prompt,
                        image_path=str(image_path.resolve()),
                        status="error",
                        error_message=str(exc),
                    )
                )
                folder.last_error = str(exc)
            finally:
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

    def get_config(self) -> dict:
        return self.store.config_store.load().to_dict()

    def update_config(self, payload: dict) -> dict:
        return self.store.config_store.update(payload).to_dict()

    def send_message(
        self,
        session_id: str,
        content: str,
        *,
        selected_folder_ids: list[str] | None = None,
        active_folder_id: str | None = None,
    ) -> dict:
        session = self.store.load_session(session_id)
        user_text = str(content or "").strip()
        if not user_text:
            raise ValueError("消息不能为空。")

        self._append_session_message(session, role="user", content=user_text)
        self.store.save_session(session)

        config = self.store.config_store.load()
        if not config.text_model.is_configured():
            raise ValueError("请先在图标工坊设置中填写文本模型接口地址、模型 ID 和 API 密钥。")

        templates = self.store.load_templates()
        agent_output = self.chat_agent.process_message(
            config,
            session,
            user_text,
            templates,
            selected_folder_ids=selected_folder_ids or [],
            active_folder_id=active_folder_id,
        )

        tool_results: list[IconWorkbenchToolResult] = []
        action_ids: list[str] = []
        for action in agent_output.get("actions", []):
            tool_result, pending_action = self._execute_chat_action(
                session_id,
                action,
                selected_folder_ids=selected_folder_ids or [],
                active_folder_id=active_folder_id,
            )
            if tool_result:
                tool_results.append(tool_result)
            if pending_action:
                action_ids.append(pending_action.action_id)

        session = self.store.load_session(session_id)
        self._append_session_message(
            session,
            role="assistant",
            content=str(agent_output.get("response", "") or "").strip(),
            tool_results=tool_results,
            action_ids=action_ids,
        )
        self.store.save_session(session)
        return self._serialize_session(session)

    def confirm_pending_action(self, session_id: str, action_id: str) -> dict:
        session = self.store.load_session(session_id)
        action = next((item for item in session.pending_actions if item.action_id == action_id), None)
        if not action:
            raise FileNotFoundError(action_id)

        session.pending_actions = [item for item in session.pending_actions if item.action_id != action_id]
        session.updated_at = utc_now_iso()
        self.store.save_session(session)

        folder_ids = [str(item) for item in action.payload.get("folder_ids", [])]
        if action.action_type == "generate_previews":
            self.generate_previews(session_id, folder_ids)
            session = self.store.load_session(session_id)
            folder_count = len(folder_ids) or len(session.folders)
            self._append_session_message(
                session,
                role="assistant",
                content=f"已按确认生成 {folder_count} 个文件夹的图标预览。",
                tool_results=[
                    IconWorkbenchToolResult(
                        tool_name="generate_previews",
                        success=True,
                        message=f"已提交 {folder_count} 个文件夹的预览生成。",
                    )
                ],
            )
            self.store.save_session(session)
            return {"session": self._serialize_session(session)}

        if action.action_type == "apply_icons":
            preparation = self.prepare_apply_ready(session_id, folder_ids)
            session = self.store.load_session(session_id)
            self._append_session_message(
                session,
                role="assistant",
                content=f"已确认应用图标，请桌面壳处理 {len(preparation['tasks'])} 个就绪文件夹。",
                tool_results=[
                    IconWorkbenchToolResult(
                        tool_name="apply_icons",
                        success=True,
                        message=f"待应用 {len(preparation['tasks'])} 个文件夹，跳过 {len(preparation['skipped_items'])} 个。",
                    )
                ],
            )
            self.store.save_session(session)
            return {
                "session": self._serialize_session(session),
                "client_execution": {
                    "command": "apply_ready_icons",
                    "action_type": action.action_type,
                    "tasks": preparation["tasks"],
                    "skipped_items": preparation["skipped_items"],
                },
            }

        if action.action_type == "restore_icons":
            session = self.store.load_session(session_id)
            targets = self._resolve_target_folders(session, folder_ids)
            tasks = [
                {
                    "folder_id": folder.folder_id,
                    "folder_name": folder.folder_name,
                    "folder_path": folder.folder_path,
                }
                for folder in targets
            ]
            self._append_session_message(
                session,
                role="assistant",
                content=f"已确认恢复最近一次图标，请桌面壳处理 {len(tasks)} 个文件夹。",
                tool_results=[
                    IconWorkbenchToolResult(
                        tool_name="restore_icons",
                        success=True,
                        message=f"待恢复 {len(tasks)} 个文件夹最近一次图标状态。",
                    )
                ],
            )
            self.store.save_session(session)
            return {
                "session": self._serialize_session(session),
                "client_execution": {
                    "command": "restore_ready_icons",
                    "action_type": action.action_type,
                    "tasks": tasks,
                    "skipped_items": [],
                },
            }

        raise ValueError(f"不支持的待确认动作类型: {action.action_type}")

    def dismiss_pending_action(self, session_id: str, action_id: str) -> dict:
        session = self.store.load_session(session_id)
        action = next((item for item in session.pending_actions if item.action_id == action_id), None)
        if not action:
            raise FileNotFoundError(action_id)
        session.pending_actions = [item for item in session.pending_actions if item.action_id != action_id]
        self._append_session_message(
            session,
            role="system",
            content=f"已取消待执行操作：{action.title}",
        )
        self.store.save_session(session)
        return self._serialize_session(session)

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
        content = f"{action_label}已完成：成功 {success_count}，失败 {failed_count}，跳过 {skipped_count}。"

        tool_results = [
            IconWorkbenchToolResult(
                tool_name=action_type or "client_action",
                success=str(item.get("status", "") or "") in success_statuses,
                message=str(item.get("message", "") or ""),
                payload={
                    "folder_id": item.get("folder_id"),
                    "folder_name": item.get("folder_name"),
                    "folder_path": item.get("folder_path"),
                    "status": item.get("status"),
                },
            )
            for item in results
        ]
        for item in skipped_items:
            tool_results.append(
                IconWorkbenchToolResult(
                    tool_name=action_type or "client_action",
                    success=False,
                    message=str(item.get("message", "") or ""),
                    payload={
                        "folder_id": item.get("folder_id"),
                        "folder_name": item.get("folder_name"),
                        "status": item.get("status", "skipped"),
                    },
                )
            )

        self._append_session_message(
            session,
            role="assistant",
            content=content,
            tool_results=tool_results,
        )
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
                    "image_path": current.image_path,
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

    def _execute_chat_action(
        self,
        session_id: str,
        action: dict,
        *,
        selected_folder_ids: list[str],
        active_folder_id: str | None,
    ) -> tuple[IconWorkbenchToolResult | None, IconWorkbenchPendingAction | None]:
        session = self.store.load_session(session_id)
        action_type = str(action.get("type", "") or "").strip()
        folder_ids = self._resolve_action_folder_ids(
            session,
            action,
            selected_folder_ids=selected_folder_ids,
            active_folder_id=active_folder_id,
        )

        if action_type == "show_folder_status":
            targets = self._resolve_target_folders(session, folder_ids) if folder_ids else list(session.folders)
            if not targets:
                return IconWorkbenchToolResult("show_folder_status", False, "没有可查看状态的文件夹。"), None
            summary = "；".join(
                f"{folder.folder_name}: 分析={folder.analysis_status} 版本={len(folder.versions)} 当前提示词={'已设置' if folder.current_prompt else '为空'}"
                for folder in targets[:6]
            )
            return IconWorkbenchToolResult("show_folder_status", True, summary), None

        if action_type == "analyze_folders":
            if not folder_ids:
                return IconWorkbenchToolResult("analyze_folders", False, "没有找到要分析的文件夹。"), None
            self.analyze_folders(session_id, folder_ids)
            return IconWorkbenchToolResult("analyze_folders", True, f"已分析 {len(folder_ids)} 个文件夹。"), None

        if action_type == "apply_template":
            template_id = str(action.get("template_id", "") or "").strip()
            if not template_id:
                return IconWorkbenchToolResult("apply_template", False, "没有提供模板。"), None
            if not folder_ids:
                return IconWorkbenchToolResult("apply_template", False, "没有找到要套用模板的文件夹。"), None
            self.apply_template(session_id, template_id, folder_ids)
            template = next((item for item in self.store.load_templates() if item.template_id == template_id), None)
            template_name = template.name if template else template_id
            return IconWorkbenchToolResult("apply_template", True, f"已将模板「{template_name}」套用到 {len(folder_ids)} 个文件夹。"), None

        if action_type == "update_prompt":
            folder_id = str(action.get("folder_id", "") or "").strip()
            prompt = str(action.get("prompt", "") or "").strip()
            if not folder_id or not prompt:
                return IconWorkbenchToolResult("update_prompt", False, "缺少目标文件夹或完整提示词。"), None
            self.update_folder_prompt(session_id, folder_id, prompt)
            return IconWorkbenchToolResult("update_prompt", True, "已更新当前提示词。"), None

        if action_type == "select_version":
            if not folder_ids:
                return IconWorkbenchToolResult("select_version", False, "没有找到要切换版本的文件夹。"), None
            version_id = str(action.get("version_id", "") or "").strip()
            version_scope = str(action.get("version_scope", "") or "").strip()
            session = self.store.load_session(session_id)
            resolved_targets = self._resolve_target_folders(session, folder_ids)
            selected_count = 0
            for folder in resolved_targets:
                target_version_id = version_id
                if not target_version_id and version_scope == "latest_ready":
                    ready_versions = [item for item in folder.versions if item.status == "ready"]
                    if ready_versions:
                        ready_versions.sort(key=lambda item: item.version_number, reverse=True)
                        target_version_id = ready_versions[0].version_id
                if not target_version_id:
                    continue
                self.select_version(session_id, folder.folder_id, target_version_id)
                selected_count += 1
            if selected_count == 0:
                return IconWorkbenchToolResult("select_version", False, "没有找到可切换的就绪版本。"), None
            return IconWorkbenchToolResult("select_version", True, f"已切换 {selected_count} 个文件夹的当前版本。"), None

        if action_type == "generate_previews":
            if not folder_ids:
                return IconWorkbenchToolResult("generate_previews", False, "没有找到要生成预览的文件夹。"), None
            pending_action = self._enqueue_pending_action(
                session_id,
                action_type="generate_previews",
                title="生成图标预览",
                description=f"准备为 {len(folder_ids)} 个文件夹生成新预览版本。确认后将调用图像模型。",
                payload={"folder_ids": folder_ids},
                requires_client=False,
            )
            return IconWorkbenchToolResult("generate_previews", True, "已准备生成预览，等待你确认。"), pending_action

        if action_type == "apply_icons":
            if not folder_ids:
                return IconWorkbenchToolResult("apply_icons", False, "没有找到要应用图标的文件夹。"), None
            pending_action = self._enqueue_pending_action(
                session_id,
                action_type="apply_icons",
                title="应用图标到文件夹",
                description=f"准备将当前就绪版本应用到 {len(folder_ids)} 个文件夹。确认后会在桌面壳执行。",
                payload={"folder_ids": folder_ids},
                requires_client=True,
            )
            return IconWorkbenchToolResult("apply_icons", True, "已整理出应用任务，等待你确认。"), pending_action

        if action_type == "restore_icons":
            if not folder_ids:
                return IconWorkbenchToolResult("restore_icons", False, "没有找到要恢复图标的文件夹。"), None
            pending_action = self._enqueue_pending_action(
                session_id,
                action_type="restore_icons",
                title="恢复最近一次图标",
                description=f"准备恢复 {len(folder_ids)} 个文件夹最近一次应用前的图标状态。确认后会在桌面壳执行。",
                payload={"folder_ids": folder_ids},
                requires_client=True,
            )
            return IconWorkbenchToolResult("restore_icons", True, "已准备恢复任务，等待你确认。"), pending_action

        return IconWorkbenchToolResult(action_type or "unknown", False, "暂不支持这个动作。"), None

    def _resolve_action_folder_ids(
        self,
        session: IconWorkbenchSession,
        action: dict,
        *,
        selected_folder_ids: list[str],
        active_folder_id: str | None,
    ) -> list[str]:
        explicit = [str(item) for item in action.get("folder_ids", []) if str(item).strip()]
        available = {folder.folder_id for folder in session.folders}
        valid_explicit = [item for item in explicit if item in available]
        if valid_explicit:
            return valid_explicit

        scope = str(action.get("scope", "") or "").strip().lower()
        if scope == "selected":
            return [item for item in selected_folder_ids if item in available]
        if scope == "active" and active_folder_id and active_folder_id in available:
            return [active_folder_id]
        if scope == "all":
            return [folder.folder_id for folder in session.folders]

        fallback_selected = [item for item in selected_folder_ids if item in available]
        if fallback_selected:
            return fallback_selected
        if active_folder_id and active_folder_id in available:
            return [active_folder_id]
        return [folder.folder_id for folder in session.folders]

    def _enqueue_pending_action(
        self,
        session_id: str,
        *,
        action_type: str,
        title: str,
        description: str,
        payload: dict,
        requires_client: bool,
    ) -> IconWorkbenchPendingAction:
        session = self.store.load_session(session_id)
        normalized_folder_ids = [str(item) for item in payload.get("folder_ids", [])]
        session.pending_actions = [
            item
            for item in session.pending_actions
            if not (
                item.action_type == action_type
                and [str(folder_id) for folder_id in item.payload.get("folder_ids", [])] == normalized_folder_ids
            )
        ]
        pending_action = IconWorkbenchPendingAction(
            action_id=uuid.uuid4().hex,
            action_type=action_type,
            title=title,
            description=description,
            requires_confirmation=True,
            requires_client=requires_client,
            payload=payload,
        )
        session.pending_actions.append(pending_action)
        session.updated_at = utc_now_iso()
        self.store.save_session(session)
        return pending_action

    def _append_session_message(
        self,
        session: IconWorkbenchSession,
        *,
        role: str,
        content: str,
        tool_results: list[IconWorkbenchToolResult] | None = None,
        action_ids: list[str] | None = None,
    ) -> None:
        session.messages.append(
            IconWorkbenchChatMessage(
                message_id=uuid.uuid4().hex,
                role=role,
                content=str(content or "").strip(),
                tool_results=list(tool_results or []),
                action_ids=list(action_ids or []),
            )
        )
        timestamp = utc_now_iso()
        session.chat_updated_at = timestamp
        session.updated_at = timestamp

    def _normalize_directory(self, path: str) -> str:
        normalized = os.path.abspath(str(path or "").strip())
        if not normalized or not os.path.isdir(normalized):
            raise ValueError("目标目录不存在。")
        return normalized

    def _list_immediate_subfolders(self, parent_dir: str) -> list[str]:
        parent = Path(parent_dir)
        folders = [
            str(entry.resolve())
            for entry in parent.iterdir()
            if entry.is_dir() and not entry.name.startswith(".")
        ]
        folders.sort(key=lambda item: Path(item).name.lower())
        return folders

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
