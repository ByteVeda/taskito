"""Thread-local context for the currently executing job."""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import TYPE_CHECKING, Any

logger = logging.getLogger("taskito.context")

if TYPE_CHECKING:
    from taskito.app import Queue

_local = threading.local()
_queue_ref: Queue | None = None


class JobContext:
    """Provides access to the currently executing job's metadata and controls.

    Usage inside a task::

        from taskito.context import current_job

        @queue.task()
        def process(data):
            current_job.update_progress(50)
            current_job.log("Processing started", level="info")
            current_job.check_cancelled()  # raises TaskCancelledError if cancelled
            current_job.check_timeout()    # raises SoftTimeoutError if exceeded
            ...
            current_job.update_progress(100)
    """

    @property
    def id(self) -> str:
        """The ID of the currently executing job."""
        return self._require_context().job_id

    @property
    def task_name(self) -> str:
        """The name of the currently executing task."""
        return self._require_context().task_name

    @property
    def retry_count(self) -> int:
        """How many times this job has been retried."""
        return self._require_context().retry_count

    @property
    def queue_name(self) -> str:
        """The queue this job is running on."""
        return self._require_context().queue_name

    def update_progress(self, progress: int) -> None:
        """Update the job's progress (0-100)."""
        ctx = self._require_context()
        if _queue_ref is None:
            raise RuntimeError("Queue reference not set. Cannot update progress.")
        _queue_ref._inner.update_progress(ctx.job_id, progress)

    def log(
        self,
        message: str,
        level: str = "info",
        extra: dict | None = None,
    ) -> None:
        """Write a structured log entry for this job.

        Args:
            message: The log message.
            level: Log level (``"debug"``, ``"info"``, ``"warning"``, ``"error"``).
            extra: Optional dict of structured data to attach.
        """
        ctx = self._require_context()
        if _queue_ref is None:
            raise RuntimeError("Queue reference not set. Cannot write log.")
        if extra:
            try:
                extra_str = json.dumps(extra)
            except (TypeError, ValueError):
                logger.warning("Non-serializable extra dict in task log, falling back to str()")
                extra_str = str(extra)
        else:
            extra_str = None
        _queue_ref._inner.write_task_log(ctx.job_id, ctx.task_name, level, message, extra_str)

    def publish(self, data: Any) -> None:
        """Publish a partial result visible to ``job.stream()`` consumers.

        Use this to stream intermediate results from long-running tasks
        (e.g. batch processing, ETL pipelines, ML training steps).

        Args:
            data: Any JSON-serializable value. Stored as a task log entry
                with ``level="result"`` so it can be filtered from regular logs.
        """
        ctx = self._require_context()
        if _queue_ref is None:
            raise RuntimeError("Queue reference not set.")
        try:
            extra_str = json.dumps(data)
        except (TypeError, ValueError):
            extra_str = str(data)
        _queue_ref._inner.write_task_log(ctx.job_id, ctx.task_name, "result", "", extra_str)

    def check_cancelled(self) -> None:
        """Check if cancellation has been requested for this job.

        Raises:
            TaskCancelledError: If the job has been marked for cancellation.
        """
        from taskito.exceptions import TaskCancelledError

        ctx = self._require_context()
        if _queue_ref is None:
            raise RuntimeError("Queue reference not set.")
        if _queue_ref._inner.is_cancel_requested(ctx.job_id):
            raise TaskCancelledError(f"Job {ctx.job_id} was cancelled")

    def check_timeout(self) -> None:
        """Check if the soft timeout has been exceeded.

        Raises:
            SoftTimeoutError: If the soft timeout has elapsed.
        """
        from taskito.exceptions import SoftTimeoutError

        ctx = self._require_context()
        if ctx.soft_timeout is not None and ctx.started_mono is not None:
            elapsed = time.monotonic() - ctx.started_mono
            if elapsed > ctx.soft_timeout:
                raise SoftTimeoutError(
                    f"Soft timeout exceeded: {elapsed:.1f}s > {ctx.soft_timeout}s"
                )

    def _set_soft_timeout(self, seconds: float) -> None:
        """Set the soft timeout on the current context (called by wrapper)."""
        ctx = self._require_context()
        ctx.soft_timeout = seconds

    @staticmethod
    def _require_context() -> _ActiveContext:
        # Try contextvars first (async tasks on native executor)
        from taskito.async_support.context import get_async_context

        ctx = get_async_context()
        if ctx is not None:
            return ctx
        # Fall back to threading.local (sync tasks)
        sync_ctx: _ActiveContext | None = getattr(_local, "context", None)
        if sync_ctx is None:
            raise RuntimeError(
                "No active job context. current_job can only be used inside a running task."
            )
        return sync_ctx


class _ActiveContext:
    __slots__ = (
        "job_id",
        "queue_name",
        "retry_count",
        "soft_timeout",
        "started_mono",
        "task_name",
    )

    def __init__(
        self,
        job_id: str,
        task_name: str,
        retry_count: int,
        queue_name: str,
    ):
        self.job_id = job_id
        self.task_name = task_name
        self.retry_count = retry_count
        self.queue_name = queue_name
        self.started_mono: float | None = time.monotonic()
        self.soft_timeout: float | None = None


def _set_queue_ref(queue: Any) -> None:
    """Store the Queue instance at module level for use by job context."""
    global _queue_ref
    _queue_ref = queue


def _set_context(
    job_id: str,
    task_name: str,
    retry_count: int,
    queue_name: str,
) -> None:
    """Set the thread-local job context. Called from Rust worker before each task."""
    _local.context = _ActiveContext(
        job_id=job_id,
        task_name=task_name,
        retry_count=retry_count,
        queue_name=queue_name,
    )


def _clear_context() -> None:
    """Clear the thread-local job context. Called from Rust worker after each task."""
    _local.context = None


current_job = JobContext()
