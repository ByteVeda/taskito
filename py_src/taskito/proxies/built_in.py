"""Register built-in proxy handlers."""

from __future__ import annotations

from taskito.proxies.handlers.file import FileHandler
from taskito.proxies.handlers.logger import LoggerHandler
from taskito.proxies.registry import ProxyRegistry


def register_builtin_handlers(
    registry: ProxyRegistry,
    *,
    disabled_proxies: list[str] | None = None,
    file_path_allowlist: list[str] | None = None,
) -> None:
    """Register all built-in proxy handlers into the given registry.

    Args:
        registry: The proxy registry to register handlers with.
        disabled_proxies: Handler names to skip registration for.
        file_path_allowlist: Allowed paths for the file handler.
    """
    disabled = set(disabled_proxies or [])

    if "file" not in disabled:
        registry.register(FileHandler(path_allowlist=file_path_allowlist or []))
    if "logger" not in disabled:
        registry.register(LoggerHandler())

    # Optional dependencies
    if "requests_session" not in disabled:
        try:
            from taskito.proxies.handlers.requests_session import (
                _HAS_REQUESTS,
                RequestsSessionHandler,
            )

            if _HAS_REQUESTS:
                registry.register(RequestsSessionHandler())
        except ImportError:
            pass

    if "httpx_client" not in disabled:
        try:
            from taskito.proxies.handlers.httpx_client import (
                _HAS_HTTPX,
                HttpxClientHandler,
            )

            if _HAS_HTTPX:
                registry.register(HttpxClientHandler())
        except ImportError:
            pass

    if "boto3_client" not in disabled:
        try:
            from taskito.proxies.handlers.boto3_client import (
                _HAS_BOTO3,
                Boto3ClientHandler,
            )

            if _HAS_BOTO3:
                registry.register(Boto3ClientHandler())
        except ImportError:
            pass

    if "gcs_client" not in disabled:
        try:
            from taskito.proxies.handlers.gcs_client import (
                _HAS_GCS,
                GCSClientHandler,
            )

            if _HAS_GCS:
                registry.register(GCSClientHandler())
        except ImportError:
            pass
