"""Predicates that read live system state from the queue."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from taskito.predicates.core import Predicate

if TYPE_CHECKING:
    from taskito.predicates.context import PredicateContext


@dataclass(frozen=True)
class _QueueSizeUnder(Predicate):
    limit: int
    queue_name: str | None

    def evaluate(self, ctx: PredicateContext) -> bool:
        return ctx.queue_size(self.queue_name) < self.limit


def queue_size_under(limit: int, *, queue: str | None = None) -> Predicate:
    """Allow only when the queue has fewer than ``limit`` pending jobs.

    ``queue=None`` (the default) inspects the job's own queue. Pass an
    explicit name to gate based on a different queue.
    """
    if limit <= 0:
        raise ValueError("limit must be > 0")
    return _QueueSizeUnder(limit=limit, queue_name=queue)


@dataclass(frozen=True)
class _QueuePaused(Predicate):
    queue_name: str | None

    def evaluate(self, ctx: PredicateContext) -> bool:
        return ctx.queue_paused(self.queue_name)


def queue_paused(queue: str | None = None) -> Predicate:
    """True when the queue is currently paused.

    Typically used inverted: ``~queue_paused()``.
    """
    return _QueuePaused(queue_name=queue)


@dataclass(frozen=True)
class _ErrorRateUnder(Predicate):
    max_rate: float

    def evaluate(self, ctx: PredicateContext) -> bool:
        stats = ctx.stats()
        if not stats:
            return True
        completed = int(stats.get("completed", 0))
        failed = int(stats.get("failed", 0))
        dead = int(stats.get("dead", 0))
        total = completed + failed + dead
        if total <= 0:
            return True
        rate = (failed + dead) / total
        return rate < self.max_rate


def error_rate_under(max_rate: float) -> Predicate:
    """Allow only when the global failure ratio is below ``max_rate``.

    ``max_rate`` is a fraction in (0, 1]. The metric is computed from
    backend-wide stats: ``(failed + dead) / (completed + failed + dead)``.
    When no jobs have run yet, the predicate allows.
    """
    if not 0.0 < max_rate <= 1.0:
        raise ValueError("max_rate must be in (0, 1]")
    return _ErrorRateUnder(max_rate=max_rate)
