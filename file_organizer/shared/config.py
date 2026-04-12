import os
from pathlib import Path

from openai import OpenAI


from file_organizer.shared.constants import (
    PROJECT_ROOT,
    DEFAULT_BASE_URL,
    DEFAULT_ANALYSIS_MODEL,
    DEFAULT_ORGANIZER_MODEL,
)
from file_organizer.shared.logging_utils import BACKEND_LOG_DIR, DEBUG_LOG_PATH, RUNTIME_LOG_PATH

ENV_PATH = PROJECT_ROOT / ".env"


def load_env_file(env_path: Path = ENV_PATH) -> None:
    """从项目根目录的 .env 加载配置，不覆盖已存在的环境变量。"""
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_env_file()


def get_env(name: str, default: str | None = None, required: bool = False) -> str | None:
    value = os.getenv(name, default)
    if required and not value:
        raise ValueError(f"缺少必要配置: {name}")
    return value


def _get_bool_env(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


SPOOF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
}


from file_organizer.shared.config_manager import config_manager

def create_openai_client() -> OpenAI:
    runtime = config_manager.service.get_runtime_family_config("text")
    return OpenAI(api_key=runtime["api_key"], base_url=runtime["base_url"], default_headers=SPOOF_HEADERS)


def get_image_analysis_settings() -> dict[str, str | bool | None]:
    return config_manager.service.get_runtime_family_config("vision")


def create_image_analysis_client() -> OpenAI:
    settings = get_image_analysis_settings()
    if not settings["enabled"]:
        raise ValueError("未启用图片分析配置")
    if not settings["base_url"]:
        raise ValueError("缺少必要配置: IMAGE_ANALYSIS_BASE_URL")
    if not settings["api_key"]:
        raise ValueError("缺少必要配置: IMAGE_ANALYSIS_API_KEY")
    if not settings["model"]:
        raise ValueError("缺少必要配置: IMAGE_ANALYSIS_MODEL")

    return OpenAI(
        api_key=settings["api_key"],
        base_url=settings["base_url"],
        default_headers=SPOOF_HEADERS,
    )


def get_model_names() -> tuple[str, str]:
    return (
        config_manager.get("OPENAI_MODEL", DEFAULT_ANALYSIS_MODEL),
        config_manager.get("OPENAI_MODEL", DEFAULT_ORGANIZER_MODEL),
    )


def get_analysis_model_name() -> str:
    return config_manager.get("OPENAI_MODEL", DEFAULT_ANALYSIS_MODEL)


def get_organizer_model_name() -> str:
    return config_manager.get("OPENAI_MODEL", DEFAULT_ORGANIZER_MODEL)

ANALYSIS_MODEL_NAME, ORGANIZER_MODEL_NAME = get_model_names()
DEBUG_MODE = config_manager.get("DEBUG_MODE", False)

OUTPUT_DIR = (PROJECT_ROOT / "output").resolve()
SESSIONS_DIR = (OUTPUT_DIR / "sessions").resolve()
RESULT_FILE_PATH = OUTPUT_DIR / "result.txt"
HISTORY_DIR = (OUTPUT_DIR / "history").resolve()
EXECUTION_LOG_DIR = (HISTORY_DIR / "executions").resolve()
LATEST_BY_DIRECTORY_PATH = HISTORY_DIR / "latest_by_directory.json"
RUNTIME_DIR = (OUTPUT_DIR / "runtime").resolve()
BACKEND_RUNTIME_PATH = RUNTIME_DIR / "backend.json"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
HISTORY_DIR.mkdir(parents=True, exist_ok=True)
EXECUTION_LOG_DIR.mkdir(parents=True, exist_ok=True)
RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
BACKEND_LOG_DIR.mkdir(parents=True, exist_ok=True)
