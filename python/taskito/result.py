"""Job result handle for checking status and retrieving results."""

from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING, Any

import cloudpickle

if TYPE_CHECKING:
    from taskito._taskito import PyJob
    from taskito.app import Queue


class JobResult:
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

    @property
    def status(self) -> str:
        """
        Current job status. Fetches fresh from the database.
        Returns one of: "pending", "running", "complete", "failed", "dead", "cancelled".
        """
        refreshed = self._queue._inner.get_job(self._py_job.id)
        if refreshed is not None:
            self._py_job = refreshed
        return self._py_job.status

    @property
    def progress(self) -> int | None:
        """Current progress (0-100) if reported by the task."""
        refreshed = self._queue._inner.get_job(self._py_job.id)
        if refreshed is not None:
            self._py_job = refreshed
        return self._py_job.progress

    @property
    def error(self) -> str | None:
        """Error message if the job failed."""
        refreshed = self._queue._inner.get_job(self._py_job.id)
        if refreshed is not None:
            self._py_job = refreshed
        return self._py_job.error

    @property
    def errors(self) -> list[dict]:
        """Error history for this job (one entry per failed attempt)."""
        return self._queue.job_errors(self.id)

    @property
    def dependencies(self) -> list[str]:
        """IDs of jobs this job depends on."""
        return self._queue._inner.get_dependencies(self.id)

    @property
    def dependents(self) -> list[str]:
        """IDs of jobs that depend on this job."""
        return self._queue._inner.get_dependents(self.id)

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
            RuntimeError: If the job failed or was moved to DLQ.
        """
        deadline = time.monotonic() + timeout
        current_interval = poll_interval

        while time.monotonic() < deadline:
            refreshed = self._queue._inner.get_job(self._py_job.id)
            if refreshed is not None:
                self._py_job = refreshed

            status = self._py_job.status
            if status == "complete":
                result_bytes = self._py_job.result_bytes
                if result_bytes is None:
                    return None
                return cloudpickle.loads(result_bytes)
            elif status in ("failed", "dead"):
                raise RuntimeError(
                    f"Job {self.id} {status}: {self._py_job.error or 'unknown error'}"
                )

            time.sleep(current_interval)
            current_interval = min(current_interval * 1.5, max_poll_interval)

        raise TimeoutError(
            f"Job {self.id} did not complete within {timeout}s "
            f"(current status: {self._py_job.status})"
        )

    async def aresult(
        self,
        timeout: float = 30.0,
        poll_interval: float = 0.05,
        max_poll_interval: float = 0.5,
    ) -> Any:
        """
        Async version of result(). Awaitable, non-blocking.

        Uses exponential backoff like :meth:`result`.

        Usage::

            result = await job.aresult(timeout=30)
        """
        deadline = time.monotonic() + timeout
        current_interval = poll_interval

        while time.monotonic() < deadline:
            refreshed = self._queue._inner.get_job(self._py_job.id)
            if refreshed is not None:
                self._py_job = refreshed

            status = self._py_job.status
            if status == "complete":
                result_bytes = self._py_job.result_bytes
                if result_bytes is None:
                    return None
                return cloudpickle.loads(result_bytes)
            elif status in ("failed", "dead"):
                raise RuntimeError(
                    f"Job {self.id} {status}: {self._py_job.error or 'unknown error'}"
                )

            await asyncio.sleep(current_interval)
            current_interval = min(current_interval * 1.5, max_poll_interval)

        raise TimeoutError(
            f"Job {self.id} did not complete within {timeout}s "
            f"(current status: {self._py_job.status})"
        )

    def to_dict(self) -> dict[str, Any]:
        """Convert to a plain dictionary for JSON serialization.

        Refreshes the job status from the database before building the dict.
        Does not include ``result_bytes`` (use :meth:`result` for that).
        """
        refreshed = self._queue._inner.get_job(self._py_job.id)
        if refreshed is not None:
            self._py_job = refreshed

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
