"""Topic pub/sub: N independent subscribers, each delivered its own job."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from taskito.notes import validate_and_encode_notes
from taskito.result import JobResult

if TYPE_CHECKING:
    from taskito._taskito import PyQueue
    from taskito.serializers import Serializer
    from taskito.task import TaskWrapper


class QueuePubSubMixin:
    """Publish/subscribe over topics.

    A subscriber is a normal task plus a registry row mapping
    ``(topic, subscription_name) -> (task_name, queue)``. ``publish()`` fans a
    message out as one ordinary job per active subscription, so every task
    feature — retries, DLQ, middleware, rate limits — applies per subscriber,
    and a failing subscriber never affects its siblings.

    Deliveries use the queue-level serializer (there is one payload for all
    subscribers); per-task serializer overrides don't apply to topic tasks.
    """

    _inner: PyQueue
    _serializer: Serializer
    _subscription_configs: list[dict[str, Any]]

    def subscriber(
        self,
        topic: str,
        name: str | None = None,
        queue: str = "default",
        durable: bool = True,
        **task_kwargs: Any,
    ) -> Callable[[Callable[..., Any]], TaskWrapper]:
        """Decorator registering ``fn`` as an independent subscriber of ``topic``.

        The function becomes a normal task (``task_kwargs`` are forwarded to
        :meth:`task`), and the subscription is written to storage when
        ``run_worker()`` starts — or via :meth:`declare_subscriptions` in a
        producer-only process. ``durable=False`` ties the subscription to one
        worker process: it only registers inside ``run_worker()`` and is
        reaped automatically once its worker stops heartbeating.

        Args:
            topic: Topic to subscribe to.
            name: Stable subscription identity. Defaults to the task name;
                re-registering the same ``(topic, name)`` updates the routing
                target instead of duplicating.
            queue: Queue the subscriber's delivery jobs go to.
            durable: Persist across restarts (default). ``False`` = ephemeral.
            **task_kwargs: Any :meth:`task` option (``max_retries``,
                ``timeout``, ``middleware``, ``idempotent``, ...).
        """

        def decorator(fn: Callable[..., Any]) -> TaskWrapper:
            wrapper: TaskWrapper = self.task(queue=queue, **task_kwargs)(fn)  # type: ignore[attr-defined]
            self._subscription_configs.append(
                {
                    "topic": topic,
                    "subscription_name": name or wrapper.name,
                    "task_name": wrapper.name,
                    "queue": queue,
                    "durable": durable,
                }
            )
            return wrapper

        return decorator

    def declare_subscriptions(self) -> None:
        """Write pending durable subscriptions to storage.

        Called automatically at ``run_worker()`` startup. Call it explicitly
        in a producer-only process (one that imports subscriber modules but
        never runs a worker) so ``publish()`` sees the subscriptions.
        Ephemeral subscriptions are skipped — they need an owning worker.
        """
        for config in self._subscription_configs:
            if config["durable"]:
                self._register_subscription(config, owner_worker_id=None)

    def publish(
        self,
        topic: str,
        *args: Any,
        idempotency_key: str | None = None,
        metadata: dict[str, Any] | None = None,
        notes: dict[str, Any] | None = None,
        priority: int | None = None,
        delay_seconds: float | None = None,
        max_retries: int | None = None,
        timeout: int | None = None,
        expires: float | None = None,
        result_ttl: int | None = None,
        **kwargs: Any,
    ) -> list[JobResult]:
        """Publish a message to ``topic``.

        Every active subscription receives an independent job carrying the
        same ``(args, kwargs)`` payload (at-least-once per subscriber).
        Returns one :class:`JobResult` per delivery — empty when the topic
        has no active subscribers, which is a valid pub/sub no-op.

        ``idempotency_key`` dedupes per subscriber: republishing the same key
        yields no new deliveries, and a subscription added later still gets
        its own copy. Each delivery's ``notes`` carry ``topic`` and
        ``subscription`` for filtering.
        """
        payload = self._serializer.dumps((args, kwargs))
        self._check_payload_size(topic, len(payload))  # type: ignore[attr-defined]
        py_jobs = self._inner.publish(
            topic=topic,
            payload=payload,
            idempotency_key=idempotency_key,
            metadata=json.dumps(metadata) if metadata is not None else None,
            notes=validate_and_encode_notes(notes) if notes is not None else None,
            priority=priority,
            delay_seconds=delay_seconds,
            max_retries=max_retries,
            timeout=timeout,
            expires=expires,
            result_ttl=result_ttl,
            task_defaults=self._delivery_task_defaults(),
        )
        return [JobResult(py_job=py_job, queue=self) for py_job in py_jobs]  # type: ignore[arg-type]

    def unsubscribe(self, topic: str, name: str) -> bool:
        """Remove a subscription. Returns False if none matched."""
        return self._inner.unsubscribe(topic, name)

    def pause_subscription(self, topic: str, name: str) -> bool:
        """Stop deliveries without unregistering. Returns False if unknown."""
        return self._inner.set_subscription_active(topic, name, False)

    def resume_subscription(self, topic: str, name: str) -> bool:
        """Resume a paused subscription. Returns False if unknown."""
        return self._inner.set_subscription_active(topic, name, True)

    def list_subscriptions(self, topic: str | None = None) -> list[dict[str, Any]]:
        """List subscriptions — all of them, or one topic's active ones."""
        rows = self._inner.list_subscriptions(topic)
        return [
            {
                "topic": row[0],
                "name": row[1],
                "task_name": row[2],
                "queue": row[3],
                "active": row[4],
                "durable": row[5],
            }
            for row in rows
        ]

    def list_topics(self) -> list[str]:
        """Distinct topics that currently have at least one subscription."""
        seen: dict[str, None] = {}
        for row in self._inner.list_subscriptions(None):
            seen.setdefault(row[0], None)
        return list(seen)

    def _delivery_task_defaults(self) -> dict[str, tuple[int, int, int]]:
        """Per-task ``(priority, max_retries, timeout_ms)`` from this process's
        task registry, so deliveries honor each subscriber's own settings.
        Tasks registered elsewhere fall back to queue defaults."""
        return {
            config.name: (config.priority, config.max_retries, config.timeout * 1000)
            for config in self._task_configs  # type: ignore[attr-defined]
        }

    def _register_subscription(self, config: dict[str, Any], owner_worker_id: str | None) -> None:
        self._inner.register_subscription(
            topic=config["topic"],
            subscription_name=config["subscription_name"],
            task_name=config["task_name"],
            queue=config["queue"],
            durable=config["durable"],
            owner_worker_id=owner_worker_id,
        )

    def _declare_worker_subscriptions(self, worker_id: str) -> None:
        """Flush all subscriptions at worker startup, owning the ephemeral ones."""
        for config in self._subscription_configs:
            owner = None if config["durable"] else worker_id
            self._register_subscription(config, owner_worker_id=owner)
