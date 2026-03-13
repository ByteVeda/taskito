"""ResourcePool — bounded pool for task-scoped resources."""

from __future__ import annotations

import logging
import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Any, Callable

from taskito.async_support.helpers import run_maybe_async
from taskito.exceptions import ResourceUnavailableError

logger = logging.getLogger("taskito.resources")


@dataclass
class PoolConfig:
    """Configuration for a resource pool."""

    pool_size: int
    pool_min: int = 0
    acquire_timeout: float = 10.0
    max_lifetime: float = 3600.0
    idle_timeout: float = 300.0


class ResourcePool:
    """Bounded pool of resource instances for task-scoped resources.

    Uses a semaphore for capacity control and a deque for idle instances.
    """

    def __init__(
        self,
        name: str,
        factory: Callable[..., Any],
        teardown: Callable[..., Any] | None,
        config: PoolConfig,
        dep_kwargs: dict[str, Any] | None = None,
    ) -> None:
        self._name = name
        self._factory = factory
        self._teardown = teardown
        self._config = config
        self._dep_kwargs = dep_kwargs or {}

        self._semaphore = threading.Semaphore(config.pool_size)
        self._idle: deque[tuple[Any, float]] = deque()  # (instance, created_at)
        self._lock = threading.Lock()
        self._total_acquisitions = 0
        self._total_timeouts = 0
        self._active_count = 0
        self._total_acquire_ms = 0.0
        self._shutdown = False

    def prewarm(self, count: int | None = None) -> None:
        """Create pool_min instances upfront."""
        target = count if count is not None else self._config.pool_min
        for _ in range(target):
            try:
                instance = run_maybe_async(self._factory(**self._dep_kwargs))
                self._idle.append((instance, time.monotonic()))
            except Exception:
                logger.exception("Failed to prewarm resource '%s'", self._name)
                break

    def acquire(self) -> Any:
        """Block until an instance is available or acquire_timeout expires."""
        start = time.monotonic()
        acquired = self._semaphore.acquire(timeout=self._config.acquire_timeout)
        if not acquired:
            self._total_timeouts += 1
            raise ResourceUnavailableError(
                f"Resource '{self._name}' pool timed out after {self._config.acquire_timeout}s"
            )

        with self._lock:
            self._total_acquisitions += 1
            self._active_count += 1
            self._total_acquire_ms += (time.monotonic() - start) * 1000

            # Try to reuse an idle instance
            while self._idle:
                instance, created_at = self._idle.popleft()
                if time.monotonic() - created_at < self._config.max_lifetime:
                    return instance
                # Expired — teardown and try next
                self._teardown_instance(instance)

        # No idle instance available — create a new one
        try:
            instance = run_maybe_async(self._factory(**self._dep_kwargs))
            return instance
        except Exception:
            # Release semaphore on creation failure
            with self._lock:
                self._active_count -= 1
            self._semaphore.release()
            raise

    def release(self, instance: Any) -> None:
        """Return an instance to the pool."""
        with self._lock:
            self._active_count -= 1
            if not self._shutdown:
                self._idle.append((instance, time.monotonic()))
            else:
                self._teardown_instance(instance)
        self._semaphore.release()

    def shutdown(self) -> None:
        """Destroy all instances in the pool."""
        self._shutdown = True
        with self._lock:
            while self._idle:
                instance, _ = self._idle.popleft()
                self._teardown_instance(instance)

    def stats(self) -> dict[str, Any]:
        """Return pool statistics."""
        with self._lock:
            idle = len(self._idle)
        avg_acquire = (
            self._total_acquire_ms / self._total_acquisitions if self._total_acquisitions else 0
        )
        return {
            "size": self._config.pool_size,
            "active": self._active_count,
            "idle": idle,
            "total_acquisitions": self._total_acquisitions,
            "total_timeouts": self._total_timeouts,
            "avg_acquire_ms": round(avg_acquire, 2),
        }

    def _teardown_instance(self, instance: Any) -> None:
        """Teardown a single instance, ignoring errors."""
        if self._teardown is None:
            return
        try:
            run_maybe_async(self._teardown(instance))
        except Exception:
            logger.exception("Error tearing down pooled resource '%s'", self._name)
