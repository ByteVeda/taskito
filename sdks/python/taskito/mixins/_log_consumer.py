"""Managed log-topic consumer: a daemon thread that pulls, invokes, and acks.

One thread per registered ``log_consumer``. It polls the log subscription's
cursor with the same ``read_topic``/``ack_topic`` API a caller would use by
hand, so the delivery guarantee is identical (at-least-once, cursor-based). The
thread is owned by ``run_worker`` and stopped when the worker drains.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from taskito.async_support.helpers import run_maybe_async

if TYPE_CHECKING:
    from taskito.mixins.pubsub import QueuePubSubMixin, TopicMessage

logger = logging.getLogger("taskito")


class LogConsumerThread(threading.Thread):
    """Poll one log subscription and drive its handler until asked to stop.

    Loop: read a batch after the cursor, invoke the handler per message, then
    advance the cursor to the last successfully handled message. A non-empty
    batch loops immediately to drain a backlog; an empty one waits
    ``poll_interval`` seconds (interruptibly) before polling again.
    """

    def __init__(
        self,
        queue: QueuePubSubMixin,
        config: dict[str, Any],
        stop_event: threading.Event,
    ) -> None:
        super().__init__(daemon=True, name=f"taskito-log-consumer-{config['name']}")
        self._queue = queue
        self._topic: str = config["topic"]
        self._name: str = config["name"]
        self._handler: Callable[..., Any] = config["handler"]
        self._poll_interval: float = config["poll_interval"]
        self._batch_size: int = config["batch_size"]
        self._on_error: str = config["on_error"]
        self._stop_event = stop_event

    def run(self) -> None:
        while not self._stop_event.is_set():
            try:
                messages = self._queue.read_topic(self._topic, self._name, self._batch_size)
            except Exception:
                logger.exception("log_consumer %s/%s: read failed", self._topic, self._name)
                self._stop_event.wait(self._poll_interval)
                continue

            if not messages:
                self._stop_event.wait(self._poll_interval)
                continue

            last_acked = self._drain_batch(messages)
            if last_acked is not None:
                try:
                    self._queue.ack_topic(self._topic, self._name, last_acked)
                except Exception:
                    logger.exception("log_consumer %s/%s: ack failed", self._topic, self._name)

    def _drain_batch(self, messages: list[TopicMessage]) -> str | None:
        """Invoke the handler per message, returning the id to ack up to.

        ``retry`` stops at the first failure and acks only the run of successes
        before it, so the failed message (and the rest of the batch) re-reads
        next poll. ``skip`` acks past a failure too, moving the cursor forward.
        Returns ``None`` when nothing should be acked yet.
        """
        last_acked: str | None = None
        for message in messages:
            if self._stop_event.is_set():
                break
            try:
                run_maybe_async(self._handler(*message.args, **message.kwargs))
            except Exception:
                logger.exception(
                    "log_consumer %s/%s: handler failed on message %s",
                    self._topic,
                    self._name,
                    message.id,
                )
                if self._on_error == "retry":
                    break
            last_acked = message.id
        return last_acked
