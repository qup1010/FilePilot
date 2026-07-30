"""目标目录规则初稿：读目录现有内容，反推「这里在放什么」。

从零写规则是绝大多数用户会放弃的地方；目录里已沉淀的文件就是用户
分类意图的一手证据。这里只生成初稿与依据，是否采纳由用户校订决定，
调用方不得未经用户确认直接落库。
"""

from __future__ import annotations

import json
import logging
import os
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from file_pilot.shared.config import create_openai_client, get_organizer_model_name

logger = logging.getLogger(__name__)

MAX_SAMPLE_NAMES = 40
MAX_PROFILE_ENTRIES = 500

_RULE_DRAFT_TOOL = {
    "type": "function",
    "function": {
        "name": "submit_rule_drafts",
        "description": "为每个目标目录提交规则描述初稿",
        "parameters": {
            "type": "object",
            "properties": {
                "drafts": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "path": {"type": "string", "description": "目录路径，必须与输入一致"},
                            "draft_description": {
                                "type": "string",
                                "description": "一句话规则：什么样的文件应该放进这个目录",
                            },
                            "basis": {
                                "type": "string",
                                "description": "依据：基于目录现有内容观察到了什么",
                            },
                        },
                        "required": ["path", "draft_description", "basis"],
                    },
                }
            },
            "required": ["drafts"],
        },
    },
}


@dataclass(frozen=True)
class DirectoryContentProfile:
    path: str
    label: str = ""
    current_description: str = ""
    total_entries: int = 0
    extension_counts: dict[str, int] = field(default_factory=dict)
    sample_names: list[str] = field(default_factory=list)
    readable: bool = True

    def to_dict(self) -> dict:
        return {
            "path": self.path,
            "label": self.label,
            "current_description": self.current_description,
            "total_entries": self.total_entries,
            "extension_counts": dict(self.extension_counts),
            "sample_names": list(self.sample_names),
            "readable": self.readable,
        }


@dataclass(frozen=True)
class RuleDraft:
    path: str
    draft_description: str
    basis: str

    def to_dict(self) -> dict:
        return {"path": self.path, "draft_description": self.draft_description, "basis": self.basis}


def collect_directory_content_profile(
    directory: Path,
    *,
    label: str = "",
    current_description: str = "",
) -> DirectoryContentProfile:
    """浅扫目标目录：扩展名分布 + 样本文件名。只读，不做任何写操作。"""
    path_text = str(directory)
    try:
        entries = []
        for index, entry in enumerate(directory.iterdir()):
            if index >= MAX_PROFILE_ENTRIES:
                break
            entries.append(entry)
    except OSError:
        logger.warning("rule_advisor.directory_unreadable path=%s", directory, exc_info=True)
        return DirectoryContentProfile(
            path=path_text,
            label=label,
            current_description=current_description,
            readable=False,
        )

    extension_counter: Counter[str] = Counter()
    sample_names: list[str] = []
    for entry in entries:
        if entry.is_dir():
            extension_counter["<dir>"] += 1
        else:
            extension_counter[entry.suffix.lstrip(".").lower() or "<none>"] += 1
        if len(sample_names) < MAX_SAMPLE_NAMES:
            sample_names.append(entry.name)

    return DirectoryContentProfile(
        path=path_text,
        label=label,
        current_description=current_description,
        total_entries=len(entries),
        extension_counts=dict(extension_counter.most_common()),
        sample_names=sample_names,
        readable=True,
    )


def build_rule_draft_prompt(profiles: list[DirectoryContentProfile]) -> list[dict]:
    lines = [
        "你在帮用户为一组「目标目录」撰写归类规则初稿。",
        "每个目录给出一句话规则（什么样的文件应该放进这里）和依据（基于现有内容观察到了什么）。",
        "要求：",
        "- 规则写给未来的分类器看，描述文件特征而不是复述文件名。",
        "- 重点写边界：如果两个目录语义相近，规则必须写清它们的区分标准。",
        "- 目录为空或不可读时，依据如实写明，规则基于目录名与标签保守推断。",
        "- 使用与目录标签一致的语言（默认中文）。",
        "",
        "目录清单：",
    ]
    for profile in profiles:
        lines.append(json.dumps(profile.to_dict(), ensure_ascii=False))
    return [{"role": "user", "content": "\n".join(lines)}]


def _canonical_path_key(path_text: str) -> str:
    # 模型经 JSON 往返后常把反斜杠回写成正斜杠：比较前统一分隔符与大小写
    return os.path.normcase(str(Path(str(path_text).strip())))


def parse_rule_drafts(tool_arguments: str, *, allowed_paths: set[str]) -> list[RuleDraft]:
    """解析模型输出；path 必须来自输入清单，拒收幻觉目录。"""
    try:
        payload = json.loads(tool_arguments or "{}")
    except json.JSONDecodeError as exc:
        raise ValueError(f"RULE_DRAFTS_INVALID_JSON: {exc}") from exc

    original_by_key = {_canonical_path_key(path): path for path in allowed_paths}
    drafts: list[RuleDraft] = []
    for entry in payload.get("drafts", []):
        if not isinstance(entry, dict):
            continue
        original_path = original_by_key.get(_canonical_path_key(str(entry.get("path") or "")))
        description = str(entry.get("draft_description") or "").strip()
        if original_path is None or not description:
            logger.warning("rule_advisor.draft_rejected path=%s", entry.get("path"))
            continue
        drafts.append(
            RuleDraft(
                path=original_path,
                draft_description=description,
                basis=str(entry.get("basis") or "").strip(),
            )
        )
    return drafts


def _client_base_url(client) -> str:
    base_url = getattr(client, "base_url", None)
    if base_url is None:
        return ""
    return str(base_url).rstrip("/")


def looks_like_deepseek(*, model: str | None = None, base_url: str | None = None) -> bool:
    """识别 DeepSeek 官方或兼容端点：V4 默认开启 thinking，强制 tool_choice 会 400。"""
    haystack = f"{model or ''} {base_url or ''}".lower()
    return "deepseek" in haystack


def build_rule_draft_completion_kwargs(
    *,
    model: str,
    messages: list[dict],
    base_url: str | None = None,
) -> dict:
    """构造规则初稿 completion 参数；DeepSeek 关闭 thinking 以兼容强制 tool_choice。"""
    kwargs: dict = {
        "model": model,
        "messages": messages,
        "tools": [_RULE_DRAFT_TOOL],
        "tool_choice": {"type": "function", "function": {"name": "submit_rule_drafts"}},
        "stream": False,
    }
    if looks_like_deepseek(model=model, base_url=base_url):
        # DeepSeek V4 默认 thinking=enabled；思考模式拒绝特定 tool_choice。
        # 官方：extra_body={"thinking": {"type": "disabled"}}
        kwargs["extra_body"] = {"thinking": {"type": "disabled"}}
    return kwargs


def classify_rule_draft_error(exc: BaseException) -> tuple[str, str]:
    """将模型/网络异常映射为前端可识别的 error_code + 中文说明。"""
    message = str(exc or "").strip()
    lowered = message.lower()
    if "thinking mode does not support this tool_choice" in lowered or (
        "thinking" in lowered and "tool_choice" in lowered
    ):
        return (
            "RULE_DRAFTS_THINKING_TOOL_UNSUPPORTED",
            "当前模型处于思考模式，不支持强制工具调用。请关闭 thinking，或换用支持工具调用的非思考模型。",
        )
    if "tool" in lowered and ("not support" in lowered or "unsupported" in lowered or "does not support" in lowered):
        return (
            "RULE_DRAFTS_TOOL_UNSUPPORTED",
            "当前模型不支持工具调用，无法自动生成规则初稿。请在设置中换用支持 function calling 的文本模型。",
        )
    if "401" in lowered or "unauthorized" in lowered or "authentication" in lowered or "invalid api key" in lowered:
        return ("RULE_DRAFTS_MODEL_AUTH", "模型服务认证失败，请检查设置中的 API 密钥。")
    if "429" in lowered or "rate limit" in lowered:
        return ("RULE_DRAFTS_MODEL_RATE_LIMIT", "模型服务请求过于频繁，请稍后再试。")
    if "timeout" in lowered or "timed out" in lowered:
        return ("RULE_DRAFTS_MODEL_TIMEOUT", "模型服务响应超时，请稍后重试。")
    if "connection" in lowered or "connect" in lowered or "name or service" in lowered:
        return ("RULE_DRAFTS_MODEL_NETWORK", "无法连接到模型服务，请检查网络与接口地址。")
    if message.startswith("RULE_DRAFTS_"):
        code = message.split(":", 1)[0].strip()
        return (code, "生成规则初稿失败，模型返回的内容无法解析，请重试。")
    return ("RULE_DRAFTS_MODEL_ERROR", "生成规则初稿失败，请确认模型配置后重试。")


def generate_rule_drafts(
    profiles: list[DirectoryContentProfile],
    *,
    client=None,
    model: str | None = None,
) -> list[RuleDraft]:
    if not profiles:
        return []
    client = client or create_openai_client()
    model = model or get_organizer_model_name()

    response = client.chat.completions.create(
        **build_rule_draft_completion_kwargs(
            model=model,
            messages=build_rule_draft_prompt(profiles),
            base_url=_client_base_url(client),
        )
    )
    tool_calls = response.choices[0].message.tool_calls or []
    if not tool_calls:
        raise ValueError("RULE_DRAFTS_MISSING_TOOL_CALL")
    arguments = tool_calls[0].function.arguments
    return parse_rule_drafts(arguments, allowed_paths={profile.path for profile in profiles})
