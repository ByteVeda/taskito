"""OpenTelemetry integration for taskito.

Requires the ``otel`` extra::

    pip install taskito[otel]

Usage::

    from taskito.contrib.otel import OpenTelemetryMiddleware

    queue = Queue(middleware=[OpenTelemetryMiddleware()])
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from taskito.middleware import TaskMiddleware

if TYPE_CHECKING:
    from taskito.context import JobContext

try:
    from opentelemetry import trace
    from opentelemetry.trace import StatusCode
except ImportError:
    trace = None
    StatusCode = None

_TRACER_NAME = "taskito"


class OpenTelemetryMiddleware(TaskMiddleware):
    """Middleware that creates OpenTelemetry spans for task execution.

    Each task execution produces a span with:
    - Span name: ``taskito.execute.<task_name>``
    - Attributes: ``taskito.job_id``, ``taskito.task_name``,
      ``taskito.queue``, ``taskito.retry_count``
    - Status: OK on success, ERROR on failure with exception recorded
    """

    def __init__(self, tracer_name: str = _TRACER_NAME):
        if trace is None:
            raise ImportError(
                "opentelemetry-api is required for OpenTelemetryMiddleware. "
                "Install it with: pip install taskito[otel]"
            )
        self._tracer = trace.get_tracer(tracer_name)
        self._spans: dict[str, Any] = {}

    def before(self, ctx: JobContext) -> None:
        span = self._tracer.start_span(
            f"taskito.execute.{ctx.task_name}",
            attributes={
                "taskito.job_id": ctx.id,
                "taskito.task_name": ctx.task_name,
                "taskito.queue": ctx.queue_name,
                "taskito.retry_count": ctx.retry_count,
            },
        )
        self._spans[ctx.id] = span

    def after(self, ctx: JobContext, result: Any, error: Exception | None) -> None:
        span = self._spans.pop(ctx.id, None)
        if span is None:
            return

        if error is not None:
            span.set_status(StatusCode.ERROR, str(error))
            span.record_exception(error)
        else:
            span.set_status(StatusCode.OK)

        span.end()

    def on_retry(self, ctx: JobContext, error: Exception, retry_count: int) -> None:
        span = self._spans.get(ctx.id)
        if span is not None:
            span.add_event(
                "retry",
                attributes={
                    "taskito.retry_count": retry_count,
                    "taskito.error": str(error),
                },
            )
