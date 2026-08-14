from __future__ import annotations

import socket

import pytest

from file_pilot.api.__main__ import find_available_port


def _acquire_probe_socket() -> socket.socket:
    """绑定一个远离端口上限的临时端口，避免顺延探测越界导致的偶发失败。"""
    while True:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.bind(("127.0.0.1", 0))
        if sock.getsockname()[1] < 65500:
            return sock
        sock.close()


def test_returns_preferred_port_when_free() -> None:
    sock = _acquire_probe_socket()
    port = sock.getsockname()[1]
    sock.close()
    assert find_available_port("127.0.0.1", port) == port


def test_skips_occupied_port() -> None:
    sock = _acquire_probe_socket()
    occupied = sock.getsockname()[1]
    try:
        result = find_available_port("127.0.0.1", occupied)
        assert result != occupied
        assert occupied < result < occupied + 20
    finally:
        sock.close()


def test_raises_when_range_exhausted() -> None:
    sock = _acquire_probe_socket()
    occupied = sock.getsockname()[1]
    try:
        with pytest.raises(OSError):
            find_available_port("127.0.0.1", occupied, attempts=1)
    finally:
        sock.close()
