import os
from pathlib import Path


def resolve_source_root() -> Path:
    return Path(__file__).resolve().parents[2]


def resolve_project_root() -> Path:
    override = os.getenv("FILE_PILOT_PROJECT_ROOT", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    return resolve_source_root()


PROJECT_ROOT = resolve_project_root()
DEFAULT_BASE_URL = "https://api.openai.com/v1"
DEFAULT_ANALYSIS_MODEL = "gpt-5.2"
DEFAULT_ORGANIZER_MODEL = "gpt-5.2"
