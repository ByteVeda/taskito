"""Async convenience methods for the Queue class."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import signal
from typing import TYPE_CHECKING, Any, Callable, TypeVar

if TYPE_CHECKING:
    from collections.abc import Sequence
    from concurrent.futures import Executor

    from taskito.async_support.locks import AsyncDistributedLock
    from taskito.result import JobResult

logger = logging.getLogger("taskito")

_T = TypeVar("_T")


class AsyncQueueMixin:
    """Async wrappers that delegate to sync Queue methods via run_in_executor."""

    _executor: Executor
    _inner: Any

    # -- Expected interface from sibling mixins (type-checking only) --

    if TYPE_CHECKING:

        def stats(self) -> dict[str, int]: ...
        def stats_by_queue(self, queue_name: str) -> dict[str, int]: ...
        def stats_all_queues(self) -> dict[str, dict[str, int]]: ...
        def cancel_job(self, job_id: str) -> bool: ...
        def metrics(self, task_name: str | None = ..., since: int = ...) -> dict[str, Any]: ...
        def dead_letters(self, limit: int = ..., offset: int = ...) -> list[dict]: ...
        def retry_dead(self, dead_id: str) -> str: ...
        def replay(self, job_id: str) -> JobResult: ...
        def circuit_breakers(self) -> list[dict]: ...
        def workers(self) -> list[dict]: ...
        def run_worker(
            self, queues: Sequence[str] | None = ..., tags: list[str] | None = ...
        ) -> None: ...
        def resource_status(self) -> list[dict[str, Any]]: ...

    # -----------------------------------------------------------------

    async def _run_sync(self, fn: Callable[..., _T], *args: Any, **kwargs: Any) -> _T:
        loop = asyncio.get_running_loop()
        if kwargs:
            return await loop.run_in_executor(self._executor, lambda: fn(*args, **kwargs))
        return await loop.run_in_executor(self._executor, lambda: fn(*args))

    # -- Inspection --

    async def astats(self) -> dict[str, int]:
        """Async version of :meth:`stats`."""
        return await self._run_sync(self.stats)

    async def astats_by_queue(self, queue_name: str) -> dict[str, int]:
        """Async version of :meth:`stats_by_queue`."""
        return await self._run_sync(self.stats_by_queue, queue_name)

    async def astats_all_queues(self) -> dict[str, dict[str, int]]:
        """Async version of :meth:`stats_all_queues`."""
        return await self._run_sync(self.stats_all_queues)

    async def acancel_job(self, job_id: str) -> bool:
        """Async version of :meth:`cancel_job`."""
        return await self._run_sync(self.cancel_job, job_id)

    async def ametrics(
        self,
        task_name: str | None = None,
        since: int = 3600,
    ) -> dict[str, Any]:
        """Async version of :meth:`metrics`."""
        return await self._run_sync(self.metrics, task_name=task_name, since=since)

    # -- Operations --

    async def adead_letters(self, limit: int = 10, offset: int = 0) -> list[dict]:
        """Async version of :meth:`dead_letters`."""
        return await self._run_sync(self.dead_letters, limit=limit, offset=offset)

    async def aretry_dead(self, dead_id: str) -> str:
        """Async version of :meth:`retry_dead`."""
        return await self._run_sync(self.retry_dead, dead_id)

    async def areplay(self, job_id: str) -> JobResult:
        """Async version of :meth:`replay`."""
        return await self._run_sync(self.replay, job_id)

    async def acircuit_breakers(self) -> list[dict]:
        """Async version of :meth:`circuit_breakers`."""
        return await self._run_sync(self.circuit_breakers)

    async def aworkers(self) -> list[dict]:
        """Async version of :meth:`workers`."""
        return await self._run_sync(self.workers)

    # -- Locks --

    def alock(
        self,
        name: str,
        ttl: float = 30.0,
        auto_extend: bool = True,
        owner_id: str | None = None,
        timeout: float | None = None,
        retry_interval: float = 0.1,
    ) -> AsyncDistributedLock:
        """Return an async distributed lock context manager.

        Args:
            name: Lock name (unique across the cluster).
            ttl: Lock TTL in seconds. Auto-extended at ttl/3 intervals.
            auto_extend: Whether to auto-extend the lock in a background thread.
            owner_id: Unique owner identifier. Auto-generated if not provided.
            timeout: Max seconds to wait for acquisition. None = fail immediately.
            retry_interval: Seconds between retries when timeout is set.
        """
        from taskito.async_support.locks import AsyncDistributedLock

        return AsyncDistributedLock(
            inner=self._inner,
            name=name,
            ttl=ttl,
            owner_id=owner_id,
            auto_extend=auto_extend,
            timeout=timeout,
            retry_interval=retry_interval,
        )

    # -- Worker --

    async def arun_worker(
        self,
        queues: Sequence[str] | None = None,
        tags: list[str] | None = None,
    ) -> None:
        """Async version of :meth:`run_worker`.

        Runs the blocking worker loop in a thread executor so it does not
        block the asyncio event loop.

        Args:
            queues: List of queue names to consume from.
            tags: Optional tags for worker specialization / routing.
        """
        loop = asyncio.get_running_loop()

        original_sigint = signal.getsignal(signal.SIGINT)
        original_sigterm = signal.getsignal(signal.SIGTERM)

        def _shutdown_once() -> None:
            logger.info("Warm shutdown (waiting for running tasks to finish)...")
            self._inner.request_shutdown()
            with contextlib.suppress(NotImplementedError):
                loop.remove_signal_handler(signal.SIGINT)
                loop.remove_signal_handler(signal.SIGTERM)
            signal.signal(signal.SIGINT, original_sigint)
            signal.signal(signal.SIGTERM, original_sigterm)

        loop.add_signal_handler(signal.SIGINT, _shutdown_once)
        loop.add_signal_handler(signal.SIGTERM, _shutdown_once)

        try:
            await loop.run_in_executor(None, lambda: self.run_worker(queues=queues, tags=tags))
        finally:
            with contextlib.suppress(NotImplementedError):
                loop.remove_signal_handler(signal.SIGINT)
                loop.remove_signal_handler(signal.SIGTERM)
            signal.signal(signal.SIGINT, original_sigint)
            signal.signal(signal.SIGTERM, original_sigterm)

    # -- Resources --

    async def aresource_status(self) -> list[dict[str, Any]]:
        """Async version of :meth:`resource_status`."""
        return self.resource_status()
