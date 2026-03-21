import os
from pathlib import Path

from openai import OpenAI


PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = PROJECT_ROOT / ".env"
DEFAULT_BASE_URL = "https://api.openai.com/v1"
DEFAULT_ANALYSIS_MODEL = "gpt-5.2"
DEFAULT_ORGANIZER_MODEL = "gpt-5.2"


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


_SPOOF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json",
}


def create_openai_client() -> OpenAI:
    return OpenAI(
        api_key=get_env("OPENAI_API_KEY", required=True),
        base_url=get_env("OPENAI_BASE_URL", DEFAULT_BASE_URL),
        default_headers=_SPOOF_HEADERS,
    )


def get_image_analysis_settings() -> dict[str, str | bool | None]:
    return {
        "enabled": _get_bool_env("IMAGE_ANALYSIS_ENABLED", default=False),
        "base_url": get_env("IMAGE_ANALYSIS_BASE_URL"),
        "api_key": get_env("IMAGE_ANALYSIS_API_KEY"),
        "model": get_env("IMAGE_ANALYSIS_MODEL"),
    }


def create_image_analysis_client() -> OpenAI:
    settings = get_image_analysis_settings()
    if not settings["enabled"]:
        raise ValueError("未启用图片分析配置")
    if not settings["api_key"]:
        raise ValueError("缺少必要配置: IMAGE_ANALYSIS_API_KEY")
    if not settings["model"]:
        raise ValueError("缺少必要配置: IMAGE_ANALYSIS_MODEL")

    return OpenAI(
        api_key=settings["api_key"],
        base_url=settings["base_url"] or DEFAULT_BASE_URL,
        default_headers=_SPOOF_HEADERS,
    )


ANALYSIS_MODEL_NAME = get_env("OPENAI_ANALYSIS_MODEL", DEFAULT_ANALYSIS_MODEL)
ORGANIZER_MODEL_NAME = get_env("OPENAI_ORGANIZER_MODEL", DEFAULT_ORGANIZER_MODEL)

OUTPUT_DIR = (PROJECT_ROOT / "output").resolve()
RESULT_FILE_PATH = OUTPUT_DIR / "result.txt"
HISTORY_DIR = (OUTPUT_DIR / "history").resolve()
EXECUTION_LOG_DIR = (HISTORY_DIR / "executions").resolve()
LATEST_BY_DIRECTORY_PATH = HISTORY_DIR / "latest_by_directory.json"
RUNTIME_DIR = (OUTPUT_DIR / "runtime").resolve()
BACKEND_RUNTIME_PATH = RUNTIME_DIR / "backend.json"

OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
HISTORY_DIR.mkdir(parents=True, exist_ok=True)
EXECUTION_LOG_DIR.mkdir(parents=True, exist_ok=True)
RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
