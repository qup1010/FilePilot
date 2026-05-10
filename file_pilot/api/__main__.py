from __future__ import annotations

import logging
import os

import uvicorn

from file_pilot.api.main import create_app
from file_pilot.api.runtime import clear_backend_runtime, write_backend_runtime
from file_pilot.shared.logging_utils import setup_backend_logging

logger = logging.getLogger(__name__)


def main() -> None:
    host = os.getenv("FILE_PILOT_API_HOST", "127.0.0.1")
    port = int(os.getenv("FILE_PILOT_API_PORT", "8765"))
    reload = os.getenv("FILE_PILOT_API_RELOAD", "true").lower() == "true"
    base_url = os.getenv("FILE_PILOT_API_BASE_URL", f"http://{host}:{port}")

    runtime_log_path = setup_backend_logging()
    write_backend_runtime(base_url, host, port)
    try:
        logger.info(
            "backend.starting host=%s port=%s reload=%s runtime_log=%s",
            host,
            port,
            reload,
            runtime_log_path,
        )
        if reload:
            logger.info("backend.reload_enabled cwd=%s", os.getcwd())
            uvicorn.run(
                "file_pilot.api.main:create_app",
                factory=True,
                host=host,
                port=port,
                reload=True,
                reload_dirs=["file_pilot"],
                log_config=None,
                access_log=False,
            )
        else:
            uvicorn.run(create_app(), host=host, port=port, log_config=None, access_log=False)
    finally:
        logger.info("backend.stopping host=%s port=%s", host, port)
        clear_backend_runtime()


if __name__ == "__main__":
    main()
