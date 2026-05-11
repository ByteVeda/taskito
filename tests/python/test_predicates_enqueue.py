"""Enqueue-time predicate gating tests."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest

from taskito.app import Queue
from taskito.exceptions import PredicateRejectedError
from taskito.predicates import (
    Cancel,
    Defer,
    Predicate,
    PredicateContext,
)


@dataclass(frozen=True)
class _Const(Predicate):
    value: Any

    def evaluate(self, ctx: PredicateContext) -> Any:
        return self.value


def test_true_predicate_lets_job_through(queue: Queue) -> None:
    @queue.task(predicate=_Const(True))
    def t() -> str:
        return "ran"

    job = t.delay()
    assert job.id


def test_false_predicate_defers_by_default(queue: Queue) -> None:
    @queue.task(predicate=_Const(False), default_defer_seconds=120.0)
    def t() -> str:
        return "ran"

    job = t.delay()
    # Job is enqueued with a future scheduled_at — we cannot directly read
    # the delay from the JobResult, but we can confirm the job exists
    # and is pending (not cancelled).
    job.refresh()
    assert job.status == "pending"


def test_false_predicate_cancel_action_raises(queue: Queue) -> None:
    @queue.task(predicate=_Const(False), on_false="cancel")
    def t() -> str:
        return "ran"

    with pytest.raises(PredicateRejectedError) as excinfo:
        t.delay()
    assert excinfo.value.task_name.endswith("t")


def test_cancel_outcome_always_raises(queue: Queue) -> None:
    @queue.task(predicate=_Const(Cancel(reason="bad tenant")))
    def t() -> str:
        return "ran"

    with pytest.raises(PredicateRejectedError) as excinfo:
        t.delay()
    assert excinfo.value.reason == "bad tenant"


def test_defer_outcome_adds_to_caller_delay(queue: Queue) -> None:
    @queue.task(predicate=_Const(Defer(seconds=300.0)))
    def t() -> str:
        return "ran"

    job = t.delay()
    job.refresh()
    assert job.status == "pending"


def test_on_false_rejects_invalid_value(queue: Queue) -> None:
    with pytest.raises(ValueError):

        @queue.task(predicate=_Const(False), on_false="invalid")
        def t() -> None: ...


def test_default_defer_seconds_must_be_non_negative(queue: Queue) -> None:
    with pytest.raises(ValueError):

        @queue.task(predicate=_Const(False), default_defer_seconds=-1.0)
        def t() -> None: ...


def test_predicate_extras_reach_context(queue: Queue) -> None:
    seen: dict[str, object] = {}

    class _Probe(Predicate):
        def evaluate(self, ctx: PredicateContext) -> bool:
            seen.update(ctx.extras)
            return True

    @queue.task(predicate=_Probe(), predicate_extras={"tenant": "acme"})
    def t() -> str:
        return "ran"

    t.delay()
    assert seen == {"tenant": "acme"}


def test_plain_callable_is_accepted_as_predicate(queue: Queue) -> None:
    @queue.task(predicate=lambda ctx: ctx.task_name.endswith("t"))
    def t() -> str:
        return "ran"

    job = t.delay()
    assert job.id


def test_enqueue_many_cancels_entire_batch(queue: Queue) -> None:
    @queue.task(predicate=_Const(Cancel(reason="nope")))
    def t(x: int) -> int:
        return x

    with pytest.raises(PredicateRejectedError):
        queue.enqueue_many(t.name, [(1,), (2,), (3,)])


def test_enqueue_many_with_true_predicate(queue: Queue) -> None:
    @queue.task(predicate=_Const(True))
    def t(x: int) -> int:
        return x

    results = queue.enqueue_many(t.name, [(1,), (2,), (3,)])
    assert len(results) == 3


def test_metrics_record_outcomes(queue: Queue) -> None:
    @queue.task(predicate=_Const(True))
    def allowed() -> int:
        return 1

    @queue.task(predicate=_Const(Defer(seconds=10.0)))
    def deferred() -> int:
        return 1

    allowed.delay()
    allowed.delay()
    deferred.delay()
    snap = queue._predicate_metrics.snapshot()
    assert snap["allowed"] == 2
    assert snap["deferred"] == 1
