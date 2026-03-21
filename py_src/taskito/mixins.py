"""Mixin classes that compose into the main Queue class."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from taskito.locks import DistributedLock
    from taskito.result import JobResult

_UNSET = object()  # sentinel to distinguish "not passed" from explicit None


class QueueInspectionMixin:
    """Read-only inspection, stats, and query methods for the Queue."""

    _inner: Any
    _namespace: str | None

    def get_job(self, job_id: str) -> JobResult | None:
        """Retrieve a job by its unique ID."""
        from taskito.result import JobResult

        py_job = self._inner.get_job(job_id)
        if py_job is None:
            return None
        return JobResult(py_job=py_job, queue=self)  # type: ignore[arg-type]

    def list_jobs(
        self,
        status: str | None = None,
        queue: str | None = None,
        task_name: str | None = None,
        limit: int = 50,
        offset: int = 0,
        namespace: Any = _UNSET,
    ) -> list[JobResult]:
        """List jobs with optional filters and pagination.

        By default, scoped to this queue's namespace. Pass ``namespace=None``
        explicitly to see jobs across all namespaces.
        """
        from taskito.result import JobResult

        ns = self._namespace if namespace is _UNSET else namespace
        py_jobs = self._inner.list_jobs(
            status=status,
            queue=queue,
            task_name=task_name,
            limit=limit,
            offset=offset,
            namespace=ns,
        )
        return [JobResult(py_job=pj, queue=self) for pj in py_jobs]  # type: ignore[arg-type]

    def list_jobs_filtered(
        self,
        status: str | None = None,
        queue: str | None = None,
        task_name: str | None = None,
        metadata_like: str | None = None,
        error_like: str | None = None,
        created_after: int | None = None,
        created_before: int | None = None,
        limit: int = 50,
        offset: int = 0,
        namespace: Any = _UNSET,
    ) -> list[JobResult]:
        """List jobs with extended filters.

        By default, scoped to this queue's namespace. Pass ``namespace=None``
        explicitly to see jobs across all namespaces.
        """
        from taskito.result import JobResult

        ns = self._namespace if namespace is _UNSET else namespace
        py_jobs = self._inner.list_jobs_filtered(
            status=status,
            queue=queue,
            task_name=task_name,
            metadata_like=metadata_like,
            error_like=error_like,
            created_after=created_after,
            created_before=created_before,
            limit=limit,
            offset=offset,
            namespace=ns,
        )
        return [JobResult(py_job=pj, queue=self) for pj in py_jobs]  # type: ignore[arg-type]

    def stats(self) -> dict[str, int]:
        """Get queue statistics as a dict of status counts."""
        return self._inner.stats()  # type: ignore[no-any-return]

    def stats_by_queue(self, queue_name: str) -> dict[str, int]:
        """Get queue statistics for a specific queue."""
        return self._inner.stats_by_queue(queue_name)  # type: ignore[no-any-return]

    def stats_all_queues(self) -> dict[str, dict[str, int]]:
        """Get queue statistics broken down by queue name."""
        return self._inner.stats_all_queues()  # type: ignore[no-any-return]

    def job_dag(self, job_id: str) -> dict[str, Any]:
        """Get the dependency DAG for a job.

        Returns a dict with ``nodes`` (list of job dicts) and ``edges``
        (list of ``{from, to}`` dicts).
        """
        visited: set[str] = set()
        nodes: list[dict[str, Any]] = []
        edges: list[dict[str, str]] = []

        def walk(jid: str) -> None:
            if jid in visited:
                return
            visited.add(jid)
            job = self.get_job(jid)
            if job is None:
                return
            nodes.append(job.to_dict())
            for dep_id in self._inner.get_dependencies(jid):
                edges.append({"from": dep_id, "to": jid})
                walk(dep_id)
            for dep_id in self._inner.get_dependents(jid):
                edges.append({"from": jid, "to": dep_id})
                walk(dep_id)

        walk(job_id)
        return {"nodes": nodes, "edges": edges}

    def metrics_timeseries(
        self,
        task_name: str | None = None,
        since: int = 3600,
        bucket: int = 60,
    ) -> list[dict[str, Any]]:
        """Get metrics aggregated into time buckets.

        Args:
            task_name: Filter to a specific task.
            since: Lookback window in seconds.
            bucket: Bucket size in seconds.

        Returns:
            List of dicts with ``timestamp``, ``count``, ``success``,
            ``failure``, ``avg_ms`` keys.
        """
        import time

        raw = self._inner.get_metrics(task_name=task_name, since_seconds=since)
        now_ms = int(time.time() * 1000)
        bucket_ms = bucket * 1000

        buckets: dict[int, list[dict]] = {}
        for r in raw:
            ts = r.get("recorded_at", 0)
            bucket_key = ((ts - (now_ms - since * 1000)) // bucket_ms) * bucket_ms + (
                now_ms - since * 1000
            )
            buckets.setdefault(bucket_key, []).append(r)

        result = []
        for ts in sorted(buckets):
            records = buckets[ts]
            n = len(records)
            success = sum(1 for r in records if r.get("succeeded"))
            times = [r["wall_time_ns"] / 1_000_000 for r in records]
            result.append(
                {
                    "timestamp": ts,
                    "count": n,
                    "success": success,
                    "failure": n - success,
                    "avg_ms": round(sum(times) / n, 2) if n else 0,
                }
            )

        return result

    def metrics(
        self,
        task_name: str | None = None,
        since: int = 3600,
    ) -> dict[str, Any]:
        """Get aggregated metrics for tasks."""
        raw = self._inner.get_metrics(task_name=task_name, since_seconds=since)
        return _aggregate_metrics(raw)

    def cancel_job(self, job_id: str) -> bool:
        """Cancel a pending job before it starts executing."""
        return self._inner.cancel_job(job_id)  # type: ignore[no-any-return]

    def cancel_running_job(self, job_id: str) -> bool:
        """Request cancellation of a running job.

        The task must call ``current_job.check_cancelled()`` to observe
        the cancellation. Returns True if the cancel was requested.
        """
        return self._inner.request_cancel(job_id)  # type: ignore[no-any-return]

    def update_progress(self, job_id: str, progress: int) -> None:
        """Update the progress percentage for a running job."""
        self._inner.update_progress(job_id, progress)

    def job_errors(self, job_id: str) -> list[dict]:
        """Get the error history for a job."""
        return self._inner.get_job_errors(job_id)  # type: ignore[no-any-return]

    def purge_completed(self, older_than: int = 86400) -> int:
        """Delete completed jobs older than a given age."""
        return self._inner.purge_completed(older_than)  # type: ignore[no-any-return]


class QueueOperationsMixin:
    """Dead letters, replay, circuit breakers, logs, workers, queue management."""

    _inner: Any

    # -- Dead Letters --

    def dead_letters(self, limit: int = 10, offset: int = 0) -> list[dict]:
        """List dead letter queue entries."""
        return self._inner.dead_letters(limit=limit, offset=offset)  # type: ignore[no-any-return]

    def retry_dead(self, dead_id: str) -> str:
        """Re-enqueue a dead letter job. Returns new job ID."""
        return self._inner.retry_dead(dead_id)  # type: ignore[no-any-return]

    def purge_dead(self, older_than: int = 86400) -> int:
        """Delete dead letter entries older than a given age."""
        return self._inner.purge_dead(older_than)  # type: ignore[no-any-return]

    # -- Replay --

    def replay(self, job_id: str) -> JobResult:
        """Re-enqueue a completed or failed job with the exact same payload."""
        new_id = self._inner.replay_job(job_id)
        return self.get_job(new_id)  # type: ignore[attr-defined, no-any-return]

    def replay_history(self, job_id: str) -> list[dict]:
        """Get replay history for a job."""
        return self._inner.get_replay_history(job_id)  # type: ignore[no-any-return]

    # -- Circuit Breakers --

    def circuit_breakers(self) -> list[dict]:
        """List all circuit breaker states."""
        return self._inner.list_circuit_breakers()  # type: ignore[no-any-return]

    # -- Logs --

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

    # -- Workers --

    def workers(self) -> list[dict]:
        """List all registered workers and their heartbeat status."""
        return self._inner.list_workers()  # type: ignore[no-any-return]

    # -- Queue Pause/Resume --

    def pause(self, queue_name: str = "default") -> None:
        """Pause a queue so no new jobs are dispatched from it."""
        self._inner.pause_queue(queue_name)
        if hasattr(self, "_emit_event"):
            from taskito.events import EventType

            self._emit_event(EventType.QUEUE_PAUSED, {"queue": queue_name})

    def resume(self, queue_name: str = "default") -> None:
        """Resume a paused queue."""
        self._inner.resume_queue(queue_name)
        if hasattr(self, "_emit_event"):
            from taskito.events import EventType

            self._emit_event(EventType.QUEUE_RESUMED, {"queue": queue_name})

    def paused_queues(self) -> list[str]:
        """List currently paused queues."""
        return self._inner.list_paused_queues()  # type: ignore[no-any-return]

    # -- Job Revocation --

    def purge(self, queue_name: str) -> int:
        """Cancel all pending jobs in a queue. Returns count cancelled."""
        return self._inner.purge_queue(queue_name)  # type: ignore[no-any-return]

    def revoke_task(self, task_name: str) -> int:
        """Cancel all pending jobs for a task name. Returns count cancelled."""
        return self._inner.revoke_task(task_name)  # type: ignore[no-any-return]

    # -- Job Archival --

    def archive(self, older_than: int = 86400) -> int:
        """Archive completed/dead/cancelled jobs older than the given age (seconds)."""
        return self._inner.archive_old_jobs(older_than)  # type: ignore[no-any-return]

    def list_archived(self, limit: int = 50, offset: int = 0) -> list[JobResult]:
        """List archived jobs with pagination."""
        from taskito.result import JobResult

        py_jobs = self._inner.list_archived(limit=limit, offset=offset)
        return [JobResult(py_job=pj, queue=self) for pj in py_jobs]  # type: ignore[arg-type]


class QueueLockMixin:
    """Distributed locking methods for the Queue."""

    _inner: Any

    def lock(
        self,
        name: str,
        ttl: float = 30.0,
        auto_extend: bool = True,
        owner_id: str | None = None,
        timeout: float | None = None,
        retry_interval: float = 0.1,
    ) -> DistributedLock:
        """Return a sync distributed lock context manager.

        Args:
            name: Lock name (unique across the cluster).
            ttl: Lock TTL in seconds. Auto-extended at ttl/3 intervals.
            auto_extend: Whether to auto-extend the lock in a background thread.
            owner_id: Unique owner identifier. Auto-generated if not provided.
            timeout: Max seconds to wait for acquisition. None = fail immediately.
            retry_interval: Seconds between retries when timeout is set.
        """
        from taskito.locks import DistributedLock

        return DistributedLock(
            inner=self._inner,
            name=name,
            ttl=ttl,
            owner_id=owner_id,
            auto_extend=auto_extend,
            timeout=timeout,
            retry_interval=retry_interval,
        )


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
