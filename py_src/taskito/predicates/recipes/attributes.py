"""Predicates that read job metadata."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from taskito.predicates.core import Predicate

if TYPE_CHECKING:
    from taskito.predicates.context import PredicateContext


@dataclass(frozen=True)
class _ByQueue(Predicate):
    name: str

    def evaluate(self, ctx: PredicateContext) -> bool:
        return ctx.queue == self.name


def by_queue(name: str) -> Predicate:
    """Allow only jobs whose target queue equals ``name``."""
    if not name:
        raise ValueError("queue name must be non-empty")
    return _ByQueue(name=name)


@dataclass(frozen=True)
class _ByTask(Predicate):
    name: str

    def evaluate(self, ctx: PredicateContext) -> bool:
        return ctx.task_name == self.name


def by_task(name: str) -> Predicate:
    """Allow only jobs for the given task name (full module-qualified)."""
    if not name:
        raise ValueError("task name must be non-empty")
    return _ByTask(name=name)


@dataclass(frozen=True)
class _ByPriorityAtLeast(Predicate):
    threshold: int

    def evaluate(self, ctx: PredicateContext) -> bool:
        return ctx.priority >= self.threshold


def by_priority_at_least(threshold: int) -> Predicate:
    """Allow jobs whose priority is ``>= threshold``."""
    return _ByPriorityAtLeast(threshold=threshold)


@dataclass(frozen=True)
class _RetryCountUnder(Predicate):
    limit: int

    def evaluate(self, ctx: PredicateContext) -> bool:
        return ctx.retry_count < self.limit


def retry_count_under(limit: int) -> Predicate:
    """Allow jobs whose retry counter is strictly less than ``limit``."""
    if limit < 0:
        raise ValueError("limit must be >= 0")
    return _RetryCountUnder(limit=limit)


@dataclass(frozen=True)
class _PayloadMatches(Predicate):
    path: tuple[str, ...]
    expected: Any

    def evaluate(self, ctx: PredicateContext) -> bool:
        node: Any = {"args": ctx.args, "kwargs": ctx.kwargs}
        for segment in self.path:
            node = _safe_lookup(node, segment)
            if node is _MISSING:
                return False
        return bool(node == self.expected)


_MISSING = object()


def _safe_lookup(node: Any, key: str) -> Any:
    if isinstance(node, dict):
        return node.get(key, _MISSING)
    if isinstance(node, (list, tuple)):
        try:
            return node[int(key)]
        except (ValueError, IndexError):
            return _MISSING
    return getattr(node, key, _MISSING)


def payload_matches(path: str, expected: Any) -> Predicate:
    """Match a value in args/kwargs by dotted path.

    ``path`` is a dotted string addressing a value within
    ``{"args": (...), "kwargs": {...}}``. Examples:

    * ``"kwargs.tenant_id"`` → ``ctx.kwargs["tenant_id"]``
    * ``"args.0"`` → ``ctx.args[0]``
    * ``"kwargs.config.region"`` → ``ctx.kwargs["config"]["region"]``
    """
    if not path:
        raise ValueError("path must be non-empty")
    return _PayloadMatches(path=tuple(path.split(".")), expected=expected)
