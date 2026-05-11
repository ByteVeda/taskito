"""Composable, fail-closed predicates for gating tasks.

A predicate is any subclass of :class:`Predicate` whose
:meth:`Predicate.evaluate` returns ``True`` (allow), ``False`` (deny),
:class:`Defer` (skip now, retry later), or :class:`Cancel` (skip
permanently). Predicates compose with ``&`` / ``|`` / ``~``::

    from taskito.predicates import is_business_hours, queue_paused

    @queue.task(predicate=is_business_hours() & ~queue_paused())
    def send_report(): ...

Built-in recipes are imported from :mod:`taskito.predicates.recipes`.
"""

from __future__ import annotations

from taskito.predicates.context import PredicateContext
from taskito.predicates.core import (
    AndPredicate,
    NotPredicate,
    OrPredicate,
    Predicate,
    coerce_predicate,
)
from taskito.predicates.evaluate import evaluate_predicate
from taskito.predicates.metrics import PredicateMetrics
from taskito.predicates.outcomes import Cancel, Defer, PredicateOutcome
from taskito.predicates.providers import FeatureFlagProvider, env_feature_flag_provider
from taskito.predicates.recipes import (
    after,
    before,
    by_priority_at_least,
    by_queue,
    by_task,
    env_var_truthy,
    error_rate_under,
    feature_flag,
    in_time_window,
    in_timezone,
    is_business_hours,
    is_weekend,
    payload_matches,
    queue_paused,
    queue_size_under,
    retry_count_under,
)

__all__ = [
    "AndPredicate",
    "Cancel",
    "Defer",
    "FeatureFlagProvider",
    "NotPredicate",
    "OrPredicate",
    "Predicate",
    "PredicateContext",
    "PredicateMetrics",
    "PredicateOutcome",
    "after",
    "before",
    "by_priority_at_least",
    "by_queue",
    "by_task",
    "coerce_predicate",
    "env_feature_flag_provider",
    "env_var_truthy",
    "error_rate_under",
    "evaluate_predicate",
    "feature_flag",
    "in_time_window",
    "in_timezone",
    "is_business_hours",
    "is_weekend",
    "payload_matches",
    "queue_paused",
    "queue_size_under",
    "retry_count_under",
]
