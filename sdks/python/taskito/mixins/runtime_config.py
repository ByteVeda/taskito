"""Queue-level runtime configuration: rate limits, concurrency, type registration.

These are runtime knobs callers tune after queue construction — distinct
from the decorator-level ``@queue.task(rate_limit=...)`` (which configures
one task) and from the storage-backed dashboard settings managed by
:class:`~taskito.mixins.settings.QueueSettingsMixin`.

Type registration lives here too because, conceptually, it is a runtime
adjustment to the argument-interception subsystem — not part of the task
decorator itself.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from taskito.interception.strategy import Strategy as S

if TYPE_CHECKING:
    from taskito.interception import ArgumentInterceptor


class QueueRuntimeConfigMixin:
    """Rate limits, concurrency caps, and custom type registration."""

    _queue_configs: dict[str, dict[str, Any]]
    _max_pending: dict[str, int]
    _interceptor: ArgumentInterceptor | None

    def register_type(
        self,
        python_type: type,
        strategy: str,
        *,
        resource: str | None = None,
        message: str | None = None,
        converter: Callable | None = None,
        type_key: str | None = None,
        proxy_handler: str | None = None,
    ) -> None:
        """Register a custom type with the interception system.

        Args:
            python_type: The type to register.
            strategy: One of ``"pass"``, ``"convert"``, ``"redirect"``,
                ``"reject"``, or ``"proxy"``.
            resource: Resource name for ``"redirect"`` strategy.
            message: Rejection reason for ``"reject"`` strategy.
            converter: Converter callable for ``"convert"`` strategy.
            type_key: Key for the converter reconstructor dispatch.
            proxy_handler: Handler name for ``"proxy"`` strategy.
        """
        if self._interceptor is None:
            raise RuntimeError(
                "Interception is disabled; set interception='strict' or "
                "'lenient' to use register_type()"
            )
        strat = S(strategy)
        self._interceptor._registry.register(
            python_type,
            strat,
            priority=15,
            redirect_resource=resource,
            reject_reason=message,
            converter=converter,
            type_key=type_key,
            proxy_handler=proxy_handler,
        )

    def set_queue_rate_limit(self, queue_name: str, rate_limit: str) -> None:
        """Set a rate limit for an entire queue.

        Args:
            queue_name: Queue name (e.g. ``"default"``).
            rate_limit: Rate limit string, e.g. ``"100/m"``, ``"10/s"``.
        """
        self._queue_configs.setdefault(queue_name, {})["rate_limit"] = rate_limit

    def set_queue_concurrency(self, queue_name: str, max_concurrent: int) -> None:
        """Set a maximum number of concurrent jobs for a queue.

        Args:
            queue_name: Queue name (e.g. ``"default"``).
            max_concurrent: Maximum number of jobs running simultaneously
                from this queue.
        """
        self._queue_configs.setdefault(queue_name, {})["max_concurrent"] = max_concurrent

    def set_queue_max_pending(self, queue_name: str, max_pending: int) -> None:
        """Set an opt-in admission cap on a queue's pending backlog.

        Once the queue holds ``max_pending`` pending jobs, ``enqueue`` and
        ``enqueue_many`` raise :class:`~taskito.exceptions.QueueFullError`. The
        check is a non-atomic count-then-insert (brief overshoot is possible
        under concurrent producers). Enforced producer-side, so it applies even
        when no worker is running.

        Args:
            queue_name: Queue name (e.g. ``"default"``).
            max_pending: Maximum pending jobs allowed before enqueue is rejected.
        """
        self._max_pending[queue_name] = max_pending
