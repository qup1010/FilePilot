from __future__ import annotations

import base64
import json
import time
from pathlib import Path
from typing import Any
from urllib import error, request

from file_pilot.icon_workbench.models import IconAnalysisResult, ModelConfig
from file_pilot.icon_workbench.prompts import (
    TEXT_ANALYSIS_SYSTEM_PROMPT,
    build_default_icon_prompt,
)


def _is_modelscope_endpoint(base_url: str) -> bool:
    lowered = base_url.lower()
    return "modelscope" in lowered or "dashscope" in lowered


def _normalize_endpoint(base_url: str, suffix: str) -> str:
    base = base_url.strip()
    if not base:
        return ""
    if base.endswith(suffix):
        return base
    if base.endswith("/v1"):
        return f"{base}{suffix}"
    if "/v1/" in base or base.endswith("/chat/completions") or base.endswith("/images/generations"):
        return base
    return f"{base.rstrip('/')}/v1{suffix}"


def _extract_text_content(message_content: Any) -> str:
    if isinstance(message_content, str):
        return message_content.strip()
    if isinstance(message_content, list):
        parts: list[str] = []
        for item in message_content:
            if isinstance(item, dict) and item.get("type") == "text":
                text = str(item.get("text", "") or "").strip()
                if text:
                    parts.append(text)
        return "\n".join(parts).strip()
    return ""


def _extract_json_block(raw_text: str) -> str:
    text = raw_text.strip()
    if "```json" in text:
        text = text.split("```json", 1)[1].split("```", 1)[0]
    elif "```" in text:
        text = text.split("```", 1)[1].split("```", 1)[0]
    return text.strip()


def _meaningful_parent_name(folder_path: str, folder_name: str) -> str:
    current = str(folder_name or "").strip()
    try:
        path = Path(folder_path).resolve()
    except OSError:
        path = Path(folder_path)
    parent_name = path.parent.name.strip() if path.parent else ""
    if not parent_name:
        return ""
    if parent_name.lower() == current.lower():
        return ""
    return parent_name


def _request_json(
    url: str,
    *,
    method: str,
    api_key: str,
    payload: dict[str, Any] | None = None,
    extra_headers: dict[str, str] | None = None,
    timeout: float = 120,
) -> dict[str, Any]:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {
        "Accept": "application/json",
    }
    if body is not None:
        headers["Content-Type"] = "application/json"
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if extra_headers:
        headers.update(extra_headers)

    req = request.Request(url=url, data=body, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"接口请求失败: {exc.code} {body}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"接口连接失败: {exc.reason}") from exc


def _post_json(url: str, payload: dict[str, Any], api_key: str, *, timeout: float = 120) -> dict[str, Any]:
    return _request_json(url, method="POST", payload=payload, api_key=api_key, timeout=timeout)


class IconWorkbenchTextClient:
    def complete_json(
        self,
        config: ModelConfig,
        system_prompt: str,
        user_prompt: str,
        *,
        temperature: float = 0.3,
    ) -> dict[str, Any]:
        if not config.is_configured():
            raise ValueError("文本模型配置不完整")

        url = _normalize_endpoint(config.base_url, "/chat/completions")
        payload = {
            "model": config.model,
            "temperature": temperature,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        }
        response = _post_json(url, payload, config.api_key)
        choices = response.get("choices") or []
        if not choices:
            raise RuntimeError("文本模型未返回结果")
        content = _extract_text_content(choices[0].get("message", {}).get("content", ""))
        return json.loads(_extract_json_block(content))

    def analyze_folder(
        self,
        config: ModelConfig,
        folder_path: str,
        folder_name: str,
        tree_lines: list[str],
    ) -> IconAnalysisResult:
        parent_name = _meaningful_parent_name(folder_path, folder_name)
        parent_line = f"父级文件夹名称: {parent_name}\n" if parent_name else "父级文件夹名称: (无明显上级语义)\n"
        user_prompt = (
            f"{parent_line}"
            f"当前文件夹名称: {folder_name}\n\n"
            "目录树摘要:\n"
            + ("\n".join(tree_lines) if tree_lines else "(空文件夹)")
        )
        parsed = self.complete_json(config, TEXT_ANALYSIS_SYSTEM_PROMPT, user_prompt, temperature=0.4)
        visual_subject = str(parsed.get("visual_subject", "") or "").strip()
        return IconAnalysisResult(
            category=str(parsed.get("category", "") or "").strip() or "未分类",
            visual_subject=visual_subject or folder_name,
            summary=str(parsed.get("summary", "") or "").strip() or "已根据目录结构生成图标方向。",
            suggested_prompt=build_default_icon_prompt(visual_subject or folder_name),
        )


class IconWorkbenchImageClient:
    def _build_payload(self, config: ModelConfig, prompt: str, size: str) -> dict[str, Any]:
        if _is_modelscope_endpoint(config.base_url):
            return {
                "model": config.model,
                "prompt": prompt,
                "n": 1,
                "size": size,
            }

        return {
            "model": config.model,
            "prompt": prompt,
            "size": size,
            "n": 1,
            "response_format": "b64_json",
        }

    def _read_remote_image(self, image_url: str, *, timeout: float = 120) -> bytes:
        with request.urlopen(image_url.strip(), timeout=timeout) as response:
            return response.read()

    def _poll_modelscope_result(
        self,
        url: str,
        api_key: str,
        *,
        max_wait_seconds: float = 120,
        poll_interval_seconds: float = 5,
    ) -> dict[str, Any]:
        max_attempts = max(1, int(max_wait_seconds / poll_interval_seconds))
        for _ in range(max_attempts):
            time.sleep(poll_interval_seconds)
            response = _request_json(
                url,
                method="GET",
                api_key=api_key,
                extra_headers={"X-ModelScope-Task-Type": "image_generation"},
                timeout=max(15, poll_interval_seconds + 10),
            )
            status = str(response.get("task_status", "") or "").upper()
            if status == "SUCCEED":
                return response
            if status == "FAILED":
                raise RuntimeError("ModelScope 任务执行失败")
            if status in {"PENDING", "RUNNING"}:
                continue
        raise RuntimeError(f"ModelScope 任务超时 ({int(max_wait_seconds)}秒)")

    def _generate_modelscope_png(
        self,
        url: str,
        payload: dict[str, Any],
        api_key: str,
        *,
        timeout_seconds: float = 120,
    ) -> bytes:
        response = _request_json(
            url,
            method="POST",
            payload=payload,
            api_key=api_key,
            extra_headers={"X-ModelScope-Async-Mode": "true"},
            timeout=max(20, min(timeout_seconds, 60)),
        )
        task_id = str(response.get("task_id", "") or "").strip()
        if not task_id:
            return self._extract_image_bytes(response, timeout=timeout_seconds)

        task_base_url = url.rsplit("/images/generations", 1)[0]
        task_url = f"{task_base_url}/tasks/{task_id}"
        task_response = self._poll_modelscope_result(task_url, api_key, max_wait_seconds=timeout_seconds)
        return self._extract_image_bytes(task_response, timeout=timeout_seconds)

    def _extract_image_bytes(self, response: dict[str, Any], *, timeout: float = 120) -> bytes:
        data = response.get("data")
        if isinstance(data, list) and data:
            first = data[0]
            if isinstance(first, dict):
                b64_data = first.get("b64_json")
                if isinstance(b64_data, str) and b64_data.strip():
                    return base64.b64decode(b64_data)

                image_url = first.get("url")
                if isinstance(image_url, str) and image_url.strip():
                    return self._read_remote_image(image_url, timeout=timeout)

        images = response.get("images")
        if isinstance(images, list) and images:
            first = images[0]
            if isinstance(first, dict):
                image_url = first.get("url")
                if isinstance(image_url, str) and image_url.strip():
                    return self._read_remote_image(image_url, timeout=timeout)
            elif isinstance(first, str) and first.strip():
                return self._read_remote_image(first, timeout=timeout)

        output_images = response.get("output_images")
        if isinstance(output_images, list) and output_images:
            first = output_images[0]
            if isinstance(first, str) and first.strip():
                return self._read_remote_image(first, timeout=timeout)

        raise RuntimeError("图像响应缺少可用图像数据")

    def generate_png(
        self,
        config: ModelConfig,
        prompt: str,
        size: str,
        *,
        timeout_seconds: float = 120,
    ) -> bytes:
        if not config.is_configured():
            raise ValueError("图像模型配置不完整")

        url = _normalize_endpoint(config.base_url, "/images/generations")
        payload = self._build_payload(config, prompt, size)
        if _is_modelscope_endpoint(config.base_url):
            return self._generate_modelscope_png(url, payload, config.api_key, timeout_seconds=timeout_seconds)
        response = _post_json(url, payload, config.api_key, timeout=timeout_seconds)
        return self._extract_image_bytes(response, timeout=timeout_seconds)


def scan_folder_tree(folder_path: str, max_depth: int = 2) -> list[str]:
    root = Path(folder_path)
    if not root.exists() or not root.is_dir():
        raise FileNotFoundError(folder_path)

    output: list[str] = []
    total_count = 0
    max_total_items = 80
    max_items_per_dir = 8

    def walk(directory: Path, depth: int, prefix: str) -> None:
        nonlocal total_count
        if depth > max_depth or total_count >= max_total_items:
            return

        entries = []
        for entry in directory.iterdir():
            if entry.name.startswith("."):
                continue
            if entry.name.lower() in {"desktop.ini", "icon.ico", "file-pilot-icon.ico"}:
                continue
            entries.append(entry)

        entries.sort(key=lambda item: (not item.is_dir(), item.name.lower()))
        visible = entries[:max_items_per_dir]
        hidden_count = max(0, len(entries) - len(visible))

        for index, entry in enumerate(visible):
            if total_count >= max_total_items:
                output.append(f"{prefix}... (已达上限)")
                return

            is_last = index == len(visible) - 1 and hidden_count == 0
            connector = "└─" if is_last else "├─"
            child_prefix = f"{prefix}{'   ' if is_last else '│  '}"
            label = f"{connector}📁 {entry.name}/" if entry.is_dir() else f"{connector} {entry.name}"
            output.append(f"{prefix}{label}")
            total_count += 1

            if entry.is_dir():
                walk(entry, depth + 1, child_prefix)

        if hidden_count > 0 and total_count < max_total_items:
            output.append(f"{prefix}└─ ... (还有 {hidden_count} 项)")

    walk(root, 0, "")
    return output
