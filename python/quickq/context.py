"""Thread-local context for the currently executing job."""

from __future__ import annotations

import threading
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from quickq.app import Queue

_local = threading.local()
_queue_ref: Queue | None = None


class JobContext:
    """Provides access to the currently executing job's metadata and controls.

    Usage inside a task::

        from quickq.context import current_job

        @queue.task()
        def process(data):
            current_job.update_progress(50)
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

    @staticmethod
    def _require_context() -> _ActiveContext:
        ctx: _ActiveContext | None = getattr(_local, "context", None)
        if ctx is None:
            raise RuntimeError(
                "No active job context. current_job can only be used inside a running task."
            )
        return ctx


class _ActiveContext:
    __slots__ = ("job_id", "queue_name", "retry_count", "task_name")

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
