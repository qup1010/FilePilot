from __future__ import annotations

import logging
import os
import socket

import uvicorn

from file_pilot.api.main import create_app
from file_pilot.api.runtime import clear_backend_runtime, write_backend_runtime
from file_pilot.shared.logging_utils import setup_backend_logging

logger = logging.getLogger(__name__)

DEFAULT_PORT = 8765
PORT_FALLBACK_ATTEMPTS = 20


def find_available_port(host: str, preferred: int, attempts: int = PORT_FALLBACK_ATTEMPTS) -> int:
    """从 preferred 起向后探测第一个可绑定的端口。

    默认端口可能被其他软件占用（例如 AnkiConnect 同样使用 8765）；
    桌面壳与前端都从 backend.json 读取实际地址，因此顺延端口是安全的。
    """
    for offset in range(attempts):
        candidate = preferred + offset
        probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            probe.bind((host, candidate))
        except OSError:
            continue
        finally:
            probe.close()
        return candidate
    raise OSError(f"no available port in range {preferred}-{preferred + attempts - 1} on {host}")


def main() -> None:
    host = os.getenv("FILE_PILOT_API_HOST", "127.0.0.1")
    env_port = os.getenv("FILE_PILOT_API_PORT", "").strip()
    preferred_port = int(env_port or str(DEFAULT_PORT))
    # 显式指定端口时严格使用（占用则由 uvicorn 报错）；未指定时自动避开被占用的默认端口。
    port = preferred_port if env_port else find_available_port(host, preferred_port)
    if port != preferred_port:
        logger.warning(
            "backend.port_fallback preferred=%s actual=%s reason=port_in_use",
            preferred_port,
            port,
        )
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
