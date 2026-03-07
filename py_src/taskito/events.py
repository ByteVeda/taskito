"""Job event system for taskito."""

from __future__ import annotations

import enum
import logging
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

logger = logging.getLogger("taskito.events")


class EventType(enum.Enum):
    """Types of job lifecycle events."""

    JOB_ENQUEUED = "job.enqueued"
    JOB_COMPLETED = "job.completed"
    JOB_FAILED = "job.failed"
    JOB_RETRYING = "job.retrying"
    JOB_DEAD = "job.dead"
    JOB_CANCELLED = "job.cancelled"


class EventBus:
    """In-process event bus for job lifecycle events.

    Callbacks are dispatched asynchronously in a thread pool to avoid
    blocking the worker.
    """

    def __init__(self, max_workers: int = 4):
        self._listeners: dict[EventType, list[Callable]] = defaultdict(list)
        self._executor = ThreadPoolExecutor(
            max_workers=max_workers, thread_name_prefix="taskito-events"
        )

    def on(self, event_type: EventType, callback: Callable[..., Any]) -> None:
        """Register a callback for the given event type."""
        self._listeners[event_type].append(callback)

    def emit(self, event_type: EventType, payload: dict[str, Any]) -> None:
        """Emit an event, dispatching to all registered callbacks."""
        for callback in self._listeners.get(event_type, []):
            self._executor.submit(self._safe_call, callback, event_type, payload)

    @staticmethod
    def _safe_call(callback: Callable, event_type: EventType, payload: dict[str, Any]) -> None:
        try:
            callback(event_type, payload)
        except Exception:
            logger.exception("Event callback error for %s", event_type.value)
