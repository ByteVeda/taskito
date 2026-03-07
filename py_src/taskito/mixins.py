"""Mixin classes that compose into the main Queue class."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from concurrent.futures import Executor

    from taskito.result import JobResult


class _AsyncMixin:
    """Provides a helper for running sync methods in an executor."""

    _executor: Executor

    async def _run_sync(self, fn: Any, *args: Any, **kwargs: Any) -> Any:
        loop = asyncio.get_running_loop()
        if kwargs:
            return await loop.run_in_executor(self._executor, lambda: fn(*args, **kwargs))
        return await loop.run_in_executor(self._executor, lambda: fn(*args))


class QueueMetricsMixin(_AsyncMixin):
    """Metrics inspection methods for the Queue."""

    _inner: Any

    def metrics(
        self,
        task_name: str | None = None,
        since: int = 3600,
    ) -> dict[str, Any]:
        """Get aggregated metrics for tasks."""
        raw = self._inner.get_metrics(task_name=task_name, since_seconds=since)
        return _aggregate_metrics(raw)

    async def ametrics(
        self,
        task_name: str | None = None,
        since: int = 3600,
    ) -> dict[str, Any]:
        """Async version of :meth:`metrics`."""
        return await self._run_sync(self.metrics, task_name=task_name, since=since)  # type: ignore[no-any-return]


class QueueDeadLettersMixin(_AsyncMixin):
    """Dead letter queue methods for the Queue."""

    _inner: Any

    def dead_letters(self, limit: int = 10, offset: int = 0) -> list[dict]:
        """List dead letter queue entries."""
        return self._inner.dead_letters(limit=limit, offset=offset)  # type: ignore[no-any-return]

    def retry_dead(self, dead_id: str) -> str:
        """Re-enqueue a dead letter job. Returns new job ID."""
        return self._inner.retry_dead(dead_id)  # type: ignore[no-any-return]

    def purge_dead(self, older_than: int = 86400) -> int:
        """Delete dead letter entries older than a given age."""
        return self._inner.purge_dead(older_than)  # type: ignore[no-any-return]

    async def adead_letters(self, limit: int = 10, offset: int = 0) -> list[dict]:
        """Async version of :meth:`dead_letters`."""
        return await self._run_sync(self.dead_letters, limit=limit, offset=offset)  # type: ignore[no-any-return]

    async def aretry_dead(self, dead_id: str) -> str:
        """Async version of :meth:`retry_dead`."""
        return await self._run_sync(self.retry_dead, dead_id)  # type: ignore[no-any-return]


class QueueReplayMixin(_AsyncMixin):
    """Replay API methods for the Queue."""

    _inner: Any

    def replay(self, job_id: str) -> JobResult:
        """Re-enqueue a completed or failed job with the exact same payload."""
        new_id = self._inner.replay_job(job_id)
        return self.get_job(new_id)  # type: ignore[attr-defined, no-any-return]

    async def areplay(self, job_id: str) -> JobResult:
        """Async version of :meth:`replay`."""
        return await self._run_sync(self.replay, job_id)  # type: ignore[no-any-return]

    def replay_history(self, job_id: str) -> list[dict]:
        """Get replay history for a job."""
        return self._inner.get_replay_history(job_id)  # type: ignore[no-any-return]


class QueueCircuitBreakersMixin(_AsyncMixin):
    """Circuit breaker API methods for the Queue."""

    _inner: Any

    def circuit_breakers(self) -> list[dict]:
        """List all circuit breaker states."""
        return self._inner.list_circuit_breakers()  # type: ignore[no-any-return]

    async def acircuit_breakers(self) -> list[dict]:
        """Async version of :meth:`circuit_breakers`."""
        return await self._run_sync(self.circuit_breakers)  # type: ignore[no-any-return]


class QueueLogsMixin:
    """Structured logging API methods for the Queue."""

    _inner: Any

    def task_logs(self, job_id: str) -> list[dict]:
        """Get structured logs for a specific job."""
        return self._inner.get_task_logs(job_id)  # type: ignore[no-any-return]

    def query_logs(
        self,
        task_name: str | None = None,
        level: str | None = None,
        since: int = 3600,
        limit: int = 100,
    ) -> list[dict]:
        """Query structured task logs with filters."""
        return self._inner.query_task_logs(  # type: ignore[no-any-return]
            task_name=task_name, level=level, since_seconds=since, limit=limit
        )


class QueueWorkersMixin(_AsyncMixin):
    """Worker heartbeat inspection methods for the Queue."""

    _inner: Any

    def workers(self) -> list[dict]:
        """List all registered workers and their heartbeat status."""
        return self._inner.list_workers()  # type: ignore[no-any-return]

    async def aworkers(self) -> list[dict]:
        """Async version of :meth:`workers`."""
        return await self._run_sync(self.workers)  # type: ignore[no-any-return]


def _aggregate_metrics(raw: list[dict]) -> dict[str, Any]:
    """Aggregate raw metric rows into per-task statistics."""
    from collections import defaultdict

    by_task: dict[str, list[dict]] = defaultdict(list)
    for r in raw:
        by_task[r["task_name"]].append(r)

    result = {}
    for task_name, records in by_task.items():
        times = sorted(r["wall_time_ns"] / 1_000_000 for r in records)  # ms
        n = len(times)
        success = sum(1 for r in records if r["succeeded"])

        result[task_name] = {
            "count": n,
            "success_count": success,
            "failure_count": n - success,
            "avg_ms": round(sum(times) / n, 2) if n else 0,
            "p50_ms": round(times[n // 2], 2) if n else 0,
            "p95_ms": round(times[min(int(n * 0.95), n - 1)], 2) if n else 0,
            "p99_ms": round(times[min(int(n * 0.99), n - 1)], 2) if n else 0,
            "min_ms": round(times[0], 2) if n else 0,
            "max_ms": round(times[-1], 2) if n else 0,
        }

    return result
