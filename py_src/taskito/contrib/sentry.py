"""Sentry integration for taskito.

Requires the ``sentry`` extra::

    pip install taskito[sentry]

Usage::

    from taskito.contrib.sentry import SentryMiddleware

    queue = Queue(middleware=[SentryMiddleware()])
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from taskito.middleware import TaskMiddleware

if TYPE_CHECKING:
    from taskito.context import JobContext

try:
    import sentry_sdk
except ImportError:
    sentry_sdk = None


class SentryMiddleware(TaskMiddleware):
    """Middleware that reports task errors to Sentry and sets transaction context.

    Each task execution gets:
    - A Sentry scope with tags: ``task_name``, ``job_id``, ``queue``, ``retry_count``
    - Exceptions automatically captured via ``capture_exception``
    - Retries recorded as breadcrumbs
    """

    def __init__(self) -> None:
        if sentry_sdk is None:
            raise ImportError(
                "sentry-sdk is required for SentryMiddleware. "
                "Install it with: pip install taskito[sentry]"
            )

    def before(self, ctx: JobContext) -> None:
        sentry_sdk.push_scope()
        scope = sentry_sdk.get_current_scope()
        scope.set_tag("taskito.task_name", ctx.task_name)
        scope.set_tag("taskito.job_id", ctx.id)
        scope.set_tag("taskito.queue", ctx.queue_name)
        scope.set_tag("taskito.retry_count", str(ctx.retry_count))
        scope.set_transaction_name(f"taskito:{ctx.task_name}")

    def after(self, ctx: JobContext, result: Any, error: Exception | None) -> None:
        if error is not None:
            sentry_sdk.capture_exception(error)
        sentry_sdk.pop_scope_unsafe()

    def on_retry(self, ctx: JobContext, error: Exception, retry_count: int) -> None:
        sentry_sdk.add_breadcrumb(
            category="taskito",
            message=f"Retrying {ctx.task_name} (attempt {retry_count}): {error}",
            level="warning",
        )
