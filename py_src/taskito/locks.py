"""Distributed locking for taskito."""

from __future__ import annotations

import threading
import uuid
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from types import TracebackType

    from taskito._taskito import PyQueue


class LockNotAcquiredError(Exception):
    """Raised when a distributed lock cannot be acquired."""


class DistributedLock:
    """Sync context manager for distributed locking with auto-extend.

    Usage::

        with queue.lock("my-resource", ttl=30):
            # critical section — lock is held and auto-extended
            ...

    Args:
        inner: The PyQueue backend instance.
        name: Lock name (must be unique across the cluster).
        ttl: Lock TTL in seconds. The lock is auto-extended at ttl/3 intervals.
        owner_id: Unique owner identifier. Auto-generated if not provided.
        auto_extend: Whether to auto-extend the lock in a background thread.
        timeout: Max seconds to wait for lock acquisition. None = no wait, fail immediately.
        retry_interval: Seconds between acquisition retries when timeout is set.
    """

    def __init__(
        self,
        inner: PyQueue,
        name: str,
        ttl: float = 30.0,
        owner_id: str | None = None,
        auto_extend: bool = True,
        timeout: float | None = None,
        retry_interval: float = 0.1,
    ) -> None:
        self._inner = inner
        self._name = name
        self._ttl_ms = int(ttl * 1000)
        self._owner_id = owner_id or uuid.uuid4().hex
        self._auto_extend = auto_extend
        self._timeout = timeout
        self._retry_interval = retry_interval
        self._extend_thread: threading.Thread | None = None
        self._stop_event = threading.Event()

    @property
    def name(self) -> str:
        """The lock name."""
        return self._name

    @property
    def owner_id(self) -> str:
        """The unique owner identifier."""
        return self._owner_id

    def acquire(self) -> bool:
        """Try to acquire the lock. Returns True if acquired."""
        return self._inner.acquire_lock(self._name, self._owner_id, self._ttl_ms)

    def release(self) -> bool:
        """Release the lock. Returns True if released."""
        self._stop_extend()
        return self._inner.release_lock(self._name, self._owner_id)

    def extend(self, ttl: float | None = None) -> bool:
        """Extend the lock's TTL. Returns True if extended."""
        ttl_ms = int(ttl * 1000) if ttl is not None else self._ttl_ms
        return self._inner.extend_lock(self._name, self._owner_id, ttl_ms)

    def info(self) -> dict[str, Any] | None:
        """Get lock info."""
        return self._inner.get_lock_info(self._name)

    def _start_extend(self) -> None:
        """Start auto-extend background thread."""
        if not self._auto_extend:
            return
        self._stop_event.clear()
        interval = self._ttl_ms / 3000.0  # ttl/3 in seconds
        self._extend_thread = threading.Thread(
            target=self._extend_loop,
            args=(interval,),
            daemon=True,
            name=f"taskito-lock-extend-{self._name}",
        )
        self._extend_thread.start()

    def _extend_loop(self, interval: float) -> None:
        """Background loop that extends the lock."""
        while not self._stop_event.wait(interval):
            try:
                if not self._inner.extend_lock(self._name, self._owner_id, self._ttl_ms):
                    break  # Lost the lock
            except Exception:
                break

    def _stop_extend(self) -> None:
        """Stop the auto-extend thread."""
        self._stop_event.set()
        if self._extend_thread is not None:
            self._extend_thread.join(timeout=2)
            self._extend_thread = None

    def __enter__(self) -> DistributedLock:
        if self._timeout is not None:
            import time

            deadline = time.monotonic() + self._timeout
            while True:
                if self.acquire():
                    self._start_extend()
                    return self
                if time.monotonic() >= deadline:
                    raise LockNotAcquiredError(
                        f"Could not acquire lock '{self._name}' within {self._timeout}s"
                    )
                time.sleep(self._retry_interval)
        else:
            if not self.acquire():
                raise LockNotAcquiredError(f"Could not acquire lock '{self._name}'")
            self._start_extend()
            return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: TracebackType | None,
    ) -> None:
        self.release()


def __getattr__(name: str) -> Any:
    """Backward-compatible lazy re-export of AsyncDistributedLock."""
    if name == "AsyncDistributedLock":
        from taskito.async_support.locks import AsyncDistributedLock

        return AsyncDistributedLock
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
