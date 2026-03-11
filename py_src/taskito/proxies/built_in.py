"""Register built-in proxy handlers."""

from __future__ import annotations

from taskito.proxies.handlers.file import FileHandler
from taskito.proxies.handlers.logger import LoggerHandler
from taskito.proxies.registry import ProxyRegistry


def register_builtin_handlers(registry: ProxyRegistry) -> None:
    """Register all built-in proxy handlers into the given registry."""
    registry.register(FileHandler())
    registry.register(LoggerHandler())

    # Optional dependencies
    try:
        from taskito.proxies.handlers.requests_session import (
            _HAS_REQUESTS,
            RequestsSessionHandler,
        )

        if _HAS_REQUESTS:
            registry.register(RequestsSessionHandler())
    except ImportError:
        pass

    try:
        from taskito.proxies.handlers.httpx_client import (
            _HAS_HTTPX,
            HttpxClientHandler,
        )

        if _HAS_HTTPX:
            registry.register(HttpxClientHandler())
    except ImportError:
        pass
