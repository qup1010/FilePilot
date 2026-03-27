from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any
from urllib import error, parse, request

from file_organizer.icon_workbench.models import IconAnalysisResult, ModelConfig
from file_organizer.icon_workbench.prompts import (
    TEXT_ANALYSIS_SYSTEM_PROMPT,
    build_default_icon_prompt,
)


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


def _post_json(url: str, payload: dict[str, Any], api_key: str) -> dict[str, Any]:
    encoded = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    req = request.Request(url=url, data=encoded, headers=headers, method="POST")
    try:
        with request.urlopen(req, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"接口请求失败: {exc.code} {body}") from exc
    except error.URLError as exc:
        raise RuntimeError(f"接口连接失败: {exc.reason}") from exc


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

    def analyze_folder(self, config: ModelConfig, folder_name: str, tree_lines: list[str]) -> IconAnalysisResult:
        user_prompt = f"文件夹名称: {folder_name}\n\n目录树摘要:\n" + ("\n".join(tree_lines) if tree_lines else "(空文件夹)")
        parsed = self.complete_json(config, TEXT_ANALYSIS_SYSTEM_PROMPT, user_prompt, temperature=0.4)
        visual_subject = str(parsed.get("visual_subject", "") or "").strip()
        return IconAnalysisResult(
            category=str(parsed.get("category", "") or "").strip() or "未分类",
            visual_subject=visual_subject or folder_name,
            summary=str(parsed.get("summary", "") or "").strip() or "已根据目录结构生成图标方向。",
            suggested_prompt=build_default_icon_prompt(visual_subject or folder_name),
        )


class IconWorkbenchImageClient:
    def generate_png(self, config: ModelConfig, prompt: str, size: str) -> bytes:
        if not config.is_configured():
            raise ValueError("图像模型配置不完整")

        url = _normalize_endpoint(config.base_url, "/images/generations")
        payload = {
            "model": config.model,
            "prompt": prompt,
            "size": size,
            "n": 1,
            "response_format": "b64_json",
        }
        response = _post_json(url, payload, config.api_key)
        data = response.get("data") or []
        if not data:
            raise RuntimeError("图像模型未返回图像")

        first = data[0]
        b64_data = first.get("b64_json")
        if isinstance(b64_data, str) and b64_data.strip():
            return base64.b64decode(b64_data)

        image_url = first.get("url")
        if isinstance(image_url, str) and image_url.strip():
            with request.urlopen(image_url.strip(), timeout=120) as response:
                return response.read()

        raise RuntimeError("图像响应缺少 b64_json 或 url")


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
            if entry.name.lower() in {"desktop.ini", "icon.ico", "file-organizer-icon.ico"}:
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
