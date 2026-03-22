"""Job result handle for checking status and retrieving results."""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator, Iterator
from typing import TYPE_CHECKING, Any

from taskito.async_support.result import AsyncJobResultMixin
from taskito.exceptions import (
    MaxRetriesExceededError,
    SerializationError,
    TaskCancelledError,
    TaskFailedError,
)

if TYPE_CHECKING:
    from taskito._taskito import PyJob
    from taskito.app import Queue


class JobResult(AsyncJobResultMixin):
    """
    Handle to an enqueued job. Provides methods to check status
    and retrieve results (sync and async).
    """

    def __init__(self, py_job: PyJob, queue: Queue):
        """Initialize a job result handle.

        Args:
            py_job: The underlying Rust PyJob instance.
            queue: The parent Queue used for status refresh.
        """
        self._py_job = py_job
        self._queue = queue

    @property
    def id(self) -> str:
        """The unique job ID."""
        return self._py_job.id

    def refresh(self) -> None:
        """Refresh job state from the database.

        Call this before reading ``status``, ``progress``, or ``error``
        to get the latest values. Properties return the last-fetched
        state and do **not** hit the database automatically.
        """
        refreshed = self._queue._inner.get_job(self._py_job.id)
        if refreshed is not None:
            self._py_job = refreshed

    @property
    def status(self) -> str:
        """
        Last-fetched job status. Call :meth:`refresh` first for the latest value.
        Returns one of: "pending", "running", "complete", "failed", "dead", "cancelled".
        """
        return self._py_job.status

    @property
    def progress(self) -> int | None:
        """Last-fetched progress (0-100). Call :meth:`refresh` for the latest value."""
        return self._py_job.progress

    @property
    def error(self) -> str | None:
        """Last-fetched error message. Call :meth:`refresh` for the latest value."""
        return self._py_job.error

    @property
    def errors(self) -> list[dict]:
        """Error history for this job (one entry per failed attempt)."""
        return self._queue.job_errors(self.id)

    @property
    def dependencies(self) -> list[str]:
        """IDs of jobs this job depends on."""
        return self._queue._inner.get_dependencies(self.id)  # type: ignore[no-any-return]

    @property
    def dependents(self) -> list[str]:
        """IDs of jobs that depend on this job."""
        return self._queue._inner.get_dependents(self.id)  # type: ignore[no-any-return]

    def _poll_once(self) -> tuple[str, Any]:
        """Refresh and return (status, deserialized result or None)."""
        self.refresh()
        status = self._py_job.status

        if status == "complete":
            result_bytes = self._py_job.result_bytes
            if result_bytes is None:
                return status, None
            try:
                return status, self._queue._serializer.loads(result_bytes)
            except Exception as exc:
                raise SerializationError(
                    f"Failed to deserialize result for job {self.id}: {exc}"
                ) from exc

        if status == "cancelled":
            error_msg = self._py_job.error or "job was cancelled"
            raise TaskCancelledError(f"Job {self.id} cancelled: {error_msg}")
        if status == "dead":
            error_msg = self._py_job.error or "max retries exceeded"
            raise MaxRetriesExceededError(f"Job {self.id} dead-lettered: {error_msg}")
        if status == "failed":
            error_msg = self._py_job.error or "task failed"
            raise TaskFailedError(f"Job {self.id} failed: {error_msg}")

        return status, None

    def result(
        self,
        timeout: float = 30.0,
        poll_interval: float = 0.05,
        max_poll_interval: float = 0.5,
    ) -> Any:
        """
        Block until the job completes and return the result.

        Uses exponential backoff: starts polling at ``poll_interval`` and
        gradually increases to ``max_poll_interval``.

        Args:
            timeout: Maximum seconds to wait.
            poll_interval: Initial seconds between status checks.
            max_poll_interval: Maximum seconds between status checks.

        Returns:
            The deserialized return value of the task function.

        Raises:
            TimeoutError: If the job doesn't complete within the timeout.
            TaskFailedError: If the job failed.
            MaxRetriesExceededError: If the job was moved to DLQ.
            TaskCancelledError: If the job was cancelled.
            SerializationError: If result deserialization fails.
        """
        if timeout <= 0:
            raise ValueError("timeout must be positive")
        deadline = time.monotonic() + timeout
        current_interval = poll_interval

        while True:
            status, value = self._poll_once()
            if status == "complete":
                return value
            if time.monotonic() >= deadline:
                raise TimeoutError(
                    f"Job {self.id} did not complete within {timeout}s "
                    f"(current status: {self._py_job.status})"
                )

            time.sleep(min(current_interval, max(0, deadline - time.monotonic())))
            current_interval = min(current_interval * 1.5, max_poll_interval)

    _TERMINAL_STATUSES = frozenset({"complete", "failed", "dead", "cancelled"})

    def stream(
        self,
        timeout: float = 60.0,
        poll_interval: float = 0.5,
    ) -> Iterator[Any]:
        """Iterate over partial results published by the task via ``current_job.publish()``.

        Yields each partial result as it becomes available. Stops when the
        job reaches a terminal state (complete, failed, dead, cancelled).

        Args:
            timeout: Maximum seconds to wait for results.
            poll_interval: Seconds between polls.

        Yields:
            Deserialized partial result data (whatever was passed to ``publish()``).
        """
        deadline = time.monotonic() + timeout
        last_seen_at: int = 0

        while time.monotonic() < deadline:
            logs = self._queue._inner.get_task_logs(self.id)
            for entry in logs:
                if entry["level"] != "result":
                    continue
                logged_at = entry.get("logged_at", 0)
                if logged_at <= last_seen_at:
                    continue
                last_seen_at = logged_at
                extra = entry.get("extra")
                if extra:
                    try:
                        yield json.loads(extra)
                    except (json.JSONDecodeError, TypeError):
                        yield extra

            self.refresh()
            if self._py_job.status in self._TERMINAL_STATUSES:
                return

            time.sleep(min(poll_interval, max(0, deadline - time.monotonic())))

    async def astream(
        self,
        timeout: float = 60.0,
        poll_interval: float = 0.5,
    ) -> AsyncIterator[Any]:
        """Async iterate over partial results published by the task.

        Async version of :meth:`stream`. Uses ``asyncio.sleep`` so it won't
        block the event loop.

        Args:
            timeout: Maximum seconds to wait for results.
            poll_interval: Seconds between polls.

        Yields:
            Deserialized partial result data.
        """
        deadline = time.monotonic() + timeout
        last_seen_at: int = 0

        while time.monotonic() < deadline:
            logs = self._queue._inner.get_task_logs(self.id)
            for entry in logs:
                if entry["level"] != "result":
                    continue
                logged_at = entry.get("logged_at", 0)
                if logged_at <= last_seen_at:
                    continue
                last_seen_at = logged_at
                extra = entry.get("extra")
                if extra:
                    try:
                        yield json.loads(extra)
                    except (json.JSONDecodeError, TypeError):
                        yield extra

            self.refresh()
            if self._py_job.status in self._TERMINAL_STATUSES:
                return

            await asyncio.sleep(min(poll_interval, max(0, deadline - time.monotonic())))

    def to_dict(self) -> dict[str, Any]:
        """Convert to a plain dictionary for JSON serialization.

        Refreshes the job status from the database before building the dict.
        Does not include ``result_bytes`` (use :meth:`result` for that).
        """
        self.refresh()

        return {
            "id": self._py_job.id,
            "queue": self._py_job.queue,
            "task_name": self._py_job.task_name,
            "status": self._py_job.status,
            "priority": self._py_job.priority,
            "progress": self._py_job.progress,
            "retry_count": self._py_job.retry_count,
            "max_retries": self._py_job.max_retries,
            "created_at": self._py_job.created_at,
            "scheduled_at": self._py_job.scheduled_at,
            "started_at": self._py_job.started_at,
            "completed_at": self._py_job.completed_at,
            "error": self._py_job.error,
            "timeout_ms": self._py_job.timeout_ms,
            "unique_key": self._py_job.unique_key,
            "metadata": self._py_job.metadata,
        }

    def __repr__(self) -> str:
        """Return a developer-friendly string representation."""
        return f"<JobResult id={self.id} status={self._py_job.status}>"
