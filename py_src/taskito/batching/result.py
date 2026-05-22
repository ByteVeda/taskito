"""Placeholder returned for items routed into a batch accumulator."""

from __future__ import annotations

from typing import Any


class BatchedJobResult:
    """Sentinel returned by ``Queue.enqueue()`` for items added to a batch.

    Per-item results are not available — the batch flushes as a single job
    whose result is the function's return value. If your code needs per-item
    results, do not enable ``@queue.task(batch=True)`` for that task.

    Provided so callers that pattern-match on ``isinstance(result, JobResult)``
    don't crash. The ``id`` attribute is ``None`` because the underlying job
    has not been enqueued yet.
    """

    __slots__ = ("task_name",)

    def __init__(self, task_name: str) -> None:
        self.task_name = task_name

    @property
    def id(self) -> None:
        """No job ID until the batch flushes."""
        return None

    @property
    def batched(self) -> bool:
        return True

    def result(self, *args: Any, **kwargs: Any) -> Any:
        raise NotImplementedError(
            f"task {self.task_name!r} is batched — per-item results are not "
            "available. Use a non-batched task if you need per-item results."
        )

    def status(self) -> str:
        return "batched"

    def __repr__(self) -> str:
        return f"BatchedJobResult(task_name={self.task_name!r})"
