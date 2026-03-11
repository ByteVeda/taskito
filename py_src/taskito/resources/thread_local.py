"""Thread-local storage for thread-scoped resources."""

from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any, Callable

logger = logging.getLogger("taskito.resources")


class ThreadLocalStore:
    """Thread-local storage for thread-scoped resources.

    One instance per thread, created lazily on first access.
    """

    def __init__(
        self,
        name: str,
        factory: Callable[..., Any],
        teardown: Callable[..., Any] | None,
        loop: asyncio.AbstractEventLoop | None = None,
        dep_kwargs: dict[str, Any] | None = None,
    ) -> None:
        self._name = name
        self._factory = factory
        self._teardown = teardown
        self._loop = loop
        self._dep_kwargs = dep_kwargs or {}
        self._local = threading.local()
        self._instances: dict[int, Any] = {}
        self._lock = threading.Lock()

    def get_or_create(self) -> Any:
        """Return thread-local instance, creating it on first access."""
        instance = getattr(self._local, "instance", None)
        if instance is not None:
            return instance

        instance = self._factory(**self._dep_kwargs)
        if asyncio.iscoroutine(instance):
            if self._loop and self._loop.is_running():
                instance = asyncio.run_coroutine_threadsafe(instance, self._loop).result()
            else:
                instance = asyncio.run(instance)

        self._local.instance = instance
        with self._lock:
            self._instances[threading.get_ident()] = instance
        return instance

    def teardown_all(self) -> None:
        """Tear down all thread-local instances."""
        with self._lock:
            for tid, instance in self._instances.items():
                if self._teardown is not None:
                    try:
                        result = self._teardown(instance)
                        if asyncio.iscoroutine(result):
                            if self._loop and self._loop.is_running():
                                asyncio.run_coroutine_threadsafe(result, self._loop).result()
                            else:
                                asyncio.run(result)
                    except Exception:
                        logger.exception(
                            "Error tearing down thread-local resource '%s' for thread %d",
                            self._name,
                            tid,
                        )
            self._instances.clear()
