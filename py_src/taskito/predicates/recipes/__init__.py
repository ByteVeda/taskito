"""Predefined predicate recipes.

Recipes are factory functions that return :class:`~taskito.predicates.Predicate`
instances. Each recipe accepts plain Python values so it can be used in
decorator declarations::

    @queue.task(
        predicate=is_business_hours(tz="US/Pacific")
                  & ~queue_paused()
                  | by_priority_at_least(8),
    )
    def send_report(): ...
"""

from __future__ import annotations

from taskito.predicates.recipes.attributes import (
    by_priority_at_least,
    by_queue,
    by_task,
    payload_matches,
    retry_count_under,
)
from taskito.predicates.recipes.config import (
    env_var_truthy,
    feature_flag,
)
from taskito.predicates.recipes.system import (
    error_rate_under,
    queue_paused,
    queue_size_under,
)
from taskito.predicates.recipes.time import (
    after,
    before,
    in_time_window,
    in_timezone,
    is_business_hours,
    is_weekend,
)

__all__ = [
    "after",
    "before",
    "by_priority_at_least",
    "by_queue",
    "by_task",
    "env_var_truthy",
    "error_rate_under",
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
