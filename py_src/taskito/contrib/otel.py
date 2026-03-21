"""OpenTelemetry integration for taskito.

Requires the ``otel`` extra::

    pip install taskito[otel]

Usage::

    from taskito.contrib.otel import OpenTelemetryMiddleware

    queue = Queue(middleware=[OpenTelemetryMiddleware()])
"""

from __future__ import annotations

from collections.abc import Callable
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
    - Span name: ``taskito.execute.<task_name>`` (customizable via ``span_name_fn``)
    - Attributes: ``taskito.job_id``, ``taskito.task_name``,
      ``taskito.queue``, ``taskito.retry_count`` (prefix customizable via
      ``attribute_prefix``)
    - Status: OK on success, ERROR on failure with exception recorded

    Args:
        tracer_name: OpenTelemetry tracer name.
        span_name_fn: Custom span name builder. Receives a
            :class:`~taskito.context.JobContext` and returns a string.
        attribute_prefix: Prefix for span attribute keys (default ``"taskito"``).
        extra_attributes_fn: Callable that returns extra attributes to add to
            each span. Receives a :class:`~taskito.context.JobContext`.
        task_filter: Predicate that receives a task name and returns ``True``
            to trace the task. ``None`` traces all tasks.
    """

    def __init__(
        self,
        tracer_name: str = _TRACER_NAME,
        *,
        span_name_fn: Callable[[JobContext], str] | None = None,
        attribute_prefix: str = "taskito",
        extra_attributes_fn: Callable[[JobContext], dict[str, Any]] | None = None,
        task_filter: Callable[[str], bool] | None = None,
    ):
        if trace is None:
            raise ImportError(
                "opentelemetry-api is required for OpenTelemetryMiddleware. "
                "Install it with: pip install taskito[otel]"
            )
        import threading

        self._tracer = trace.get_tracer(tracer_name)
        self._span_name_fn = span_name_fn
        self._attr_prefix = attribute_prefix
        self._extra_attributes_fn = extra_attributes_fn
        self._task_filter = task_filter
        self._spans: dict[str, Any] = {}
        self._lock = threading.Lock()

    def _should_trace(self, task_name: str) -> bool:
        return self._task_filter is None or self._task_filter(task_name)

    def _span_name(self, ctx: JobContext) -> str:
        if self._span_name_fn is not None:
            return self._span_name_fn(ctx)
        return f"{self._attr_prefix}.execute.{ctx.task_name}"

    def before(self, ctx: JobContext) -> None:
        if not self._should_trace(ctx.task_name):
            return

        prefix = self._attr_prefix
        attributes: dict[str, Any] = {
            f"{prefix}.job_id": ctx.id,
            f"{prefix}.task_name": ctx.task_name,
            f"{prefix}.queue": ctx.queue_name,
            f"{prefix}.retry_count": ctx.retry_count,
        }
        if self._extra_attributes_fn is not None:
            attributes.update(self._extra_attributes_fn(ctx))

        span = self._tracer.start_span(self._span_name(ctx), attributes=attributes)
        with self._lock:
            self._spans[ctx.id] = span

    def after(self, ctx: JobContext, result: Any, error: Exception | None) -> None:
        with self._lock:
            span = self._spans.pop(ctx.id, None)
        if span is None:
            return

        try:
            if error is not None:
                span.set_status(StatusCode.ERROR, str(error))
                span.record_exception(error)
            else:
                span.set_status(StatusCode.OK)
        finally:
            span.end()

    def on_retry(self, ctx: JobContext, error: Exception, retry_count: int) -> None:
        with self._lock:
            span = self._spans.get(ctx.id)
        if span is not None:
            prefix = self._attr_prefix
            span.add_event(
                "retry",
                attributes={
                    f"{prefix}.retry_count": retry_count,
                    f"{prefix}.error": str(error),
                },
            )
