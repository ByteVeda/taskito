"""Thread-safe per-task buffer that flushes by size or time."""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from taskito.batching.config import BatchConfig

logger = logging.getLogger("taskito.batching")


@dataclass
class _BufferState:
    """One entry per batched task name."""

    items: list[Any]
    deadline_monotonic: float  # earliest moment we must flush
    config: BatchConfig


class BatchAccumulator:
    """Owns per-task buffers and a daemon thread that flushes them on time.

    All operations are thread-safe. Items are dispatched via the
    ``dispatch`` callback, which receives ``(task_name, items_list,
    config)`` and is responsible for actually enqueueing the batched
    payload (see :meth:`Queue.enqueue_batched_payload` in ``app.py``).

    A single flusher thread serves every batched task on the queue. It
    sleeps on a condition variable that wakes either on the next deadline
    or on every ``add`` (so a newly-shortened deadline is picked up
    promptly). The thread starts lazily on the first ``add`` call and
    stops cleanly on :meth:`shutdown`.
    """

    def __init__(
        self,
        dispatch: Callable[[str, list[Any], BatchConfig], None],
    ) -> None:
        self._dispatch = dispatch
        self._lock = threading.Lock()
        self._cond = threading.Condition(self._lock)
        self._buffers: dict[str, _BufferState] = {}
        self._flusher: threading.Thread | None = None
        self._stop = threading.Event()

    def add(self, task_name: str, item: Any, config: BatchConfig) -> None:
        """Add an item to the named task's batch. Flushes synchronously if
        the buffer reached ``max_size``."""
        to_flush: list[Any] | None = None
        flush_config = config
        with self._cond:
            state = self._buffers.get(task_name)
            if state is None:
                state = _BufferState(
                    items=[item],
                    deadline_monotonic=time.monotonic() + config.max_wait_ms / 1000.0,
                    config=config,
                )
                self._buffers[task_name] = state
            else:
                # If the per-call config changed, keep the original — the
                # decorator is the source of truth and shouldn't change
                # between calls. (Defensive: still honor the new max_size if
                # it's stricter.)
                state.items.append(item)

            if len(state.items) >= state.config.max_size:
                to_flush = state.items
                flush_config = state.config
                del self._buffers[task_name]

            self._cond.notify_all()
            self._ensure_flusher_locked()

        if to_flush is not None:
            self._safe_dispatch(task_name, to_flush, flush_config)

    def flush_all(self) -> None:
        """Synchronously flush every non-empty buffer.

        Called from :meth:`Queue.close` and from atexit. Items still in the
        buffer at process exit without an explicit close are lost — this
        matches Celery ``Batches`` semantics.
        """
        with self._cond:
            pending = list(self._buffers.items())
            self._buffers.clear()
            self._cond.notify_all()
        for task_name, state in pending:
            self._safe_dispatch(task_name, state.items, state.config)

    def shutdown(self, *, flush: bool = True) -> None:
        """Stop the flusher thread.

        When ``flush=True`` (the default), any pending items are dispatched
        first. When ``flush=False``, pending items are dropped — useful in
        tests that want to observe loss behavior deterministically.
        """
        if flush:
            self.flush_all()
        self._stop.set()
        with self._cond:
            self._cond.notify_all()
        if self._flusher is not None:
            self._flusher.join(timeout=2)
            self._flusher = None

    # ── Internal ───────────────────────────────────────────────────────

    def _ensure_flusher_locked(self) -> None:
        """Start the daemon thread if not already running. Caller holds the lock."""
        if self._flusher is not None or self._stop.is_set():
            return
        self._flusher = threading.Thread(
            target=self._flusher_loop,
            daemon=True,
            name="taskito-batch-flusher",
        )
        self._flusher.start()

    def _flusher_loop(self) -> None:
        while not self._stop.is_set():
            with self._cond:
                if not self._buffers:
                    self._cond.wait()
                    continue
                now = time.monotonic()
                next_deadline = min(s.deadline_monotonic for s in self._buffers.values())
                if next_deadline > now:
                    self._cond.wait(timeout=next_deadline - now)
                    continue

                # Drain any buffer whose deadline has passed.
                expired: list[tuple[str, list[Any], BatchConfig]] = []
                for task_name in list(self._buffers.keys()):
                    state = self._buffers[task_name]
                    if state.deadline_monotonic <= now:
                        expired.append((task_name, state.items, state.config))
                        del self._buffers[task_name]

            for task_name, items, config in expired:
                self._safe_dispatch(task_name, items, config)

    def _safe_dispatch(
        self,
        task_name: str,
        items: list[Any],
        config: BatchConfig,
    ) -> None:
        try:
            self._dispatch(task_name, items, config)
        except Exception:
            # Don't let one bad batch take down the flusher thread.
            logger.exception("batch dispatch failed for task=%s items=%d", task_name, len(items))
