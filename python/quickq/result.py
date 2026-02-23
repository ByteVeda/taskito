"""Job result handle for checking status and retrieving results."""

from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING, Any

import cloudpickle

if TYPE_CHECKING:
    from quickq._quickq import PyJob
    from quickq.app import Queue


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
        Returns one of: "pending", "running", "complete", "failed", "dead".
        """
        refreshed = self._queue._inner.get_job(self._py_job.id)
        if refreshed is not None:
            self._py_job = refreshed
        return self._py_job.status

    @property
    def error(self) -> str | None:
        """Error message if the job failed."""
        refreshed = self._queue._inner.get_job(self._py_job.id)
        if refreshed is not None:
            self._py_job = refreshed
        return self._py_job.error

    def result(self, timeout: float = 30.0, poll_interval: float = 0.1) -> Any:
        """
        Block until the job completes and return the result.

        Args:
            timeout: Maximum seconds to wait.
            poll_interval: Seconds between status checks.

        Returns:
            The deserialized return value of the task function.

        Raises:
            TimeoutError: If the job doesn't complete within the timeout.
            RuntimeError: If the job failed or was moved to DLQ.
        """
        deadline = time.monotonic() + timeout

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

            time.sleep(poll_interval)

        raise TimeoutError(
            f"Job {self.id} did not complete within {timeout}s "
            f"(current status: {self._py_job.status})"
        )

    async def aresult(self, timeout: float = 30.0, poll_interval: float = 0.1) -> Any:
        """
        Async version of result(). Awaitable, non-blocking.

        Usage::

            result = await job.aresult(timeout=30)
        """
        deadline = time.monotonic() + timeout

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

            await asyncio.sleep(poll_interval)

        raise TimeoutError(
            f"Job {self.id} did not complete within {timeout}s "
            f"(current status: {self._py_job.status})"
        )

    def __repr__(self) -> str:
        """Return a developer-friendly string representation."""
        return f"<JobResult id={self.id} status={self._py_job.status}>"
