"""Per-task middleware system for taskito."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from taskito.context import JobContext


class TaskMiddleware:
    """Base class for task middleware.

    Subclass and override any of the hooks. Register globally via
    ``Queue(middleware=[...])`` or per-task via ``@queue.task(middleware=[...])``.

    Example::

        class LoggingMiddleware(TaskMiddleware):
            def before(self, ctx):
                print(f"Starting {ctx.task_name}")

            def after(self, ctx, result, error):
                status = "OK" if error is None else f"FAILED: {error}"
                print(f"Finished {ctx.task_name}: {status}")
    """

    def before(self, ctx: JobContext) -> None:
        """Called before task execution."""

    def after(self, ctx: JobContext, result: Any, error: Exception | None) -> None:
        """Called after task execution (success or failure)."""

    def on_retry(self, ctx: JobContext, error: Exception, retry_count: int) -> None:
        """Called when a task is about to be retried."""
