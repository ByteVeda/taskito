"""Built-in predicate recipe tests."""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from unittest import mock

import pytest

from taskito.predicates import (
    Defer,
    PredicateContext,
    after,
    before,
    by_priority_at_least,
    by_queue,
    by_task,
    env_var_truthy,
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
from taskito.predicates.providers import FeatureFlagProvider


def _ctx(**overrides: object) -> PredicateContext:
    defaults: dict[str, object] = {"task_name": "t", "queue": "default"}
    defaults.update(overrides)
    return PredicateContext(**defaults)  # type: ignore[arg-type]


# -- Time recipes -----------------------------------------------------------


def test_after_allows_when_past_target() -> None:
    target = datetime.now(timezone.utc) - timedelta(hours=1)
    assert after(target).evaluate(_ctx()) is True


def test_after_defers_when_before_target() -> None:
    target = datetime.now(timezone.utc) + timedelta(hours=1)
    outcome = after(target).evaluate(_ctx())
    assert isinstance(outcome, Defer)
    assert 3000 < outcome.seconds < 3700


def test_before_allows_when_strictly_earlier() -> None:
    target = datetime.now(timezone.utc) + timedelta(hours=1)
    assert before(target).evaluate(_ctx()) is True


def test_before_denies_when_past_target() -> None:
    target = datetime.now(timezone.utc) - timedelta(hours=1)
    assert before(target).evaluate(_ctx()) is False


def test_in_time_window_parses_hh_mm() -> None:
    assert in_time_window("09:00", "17:00") is not None


def test_in_time_window_rejects_inverted_range() -> None:
    with pytest.raises(ValueError):
        in_time_window("17:00", "09:00")


def test_in_time_window_rejects_bad_format() -> None:
    with pytest.raises(ValueError):
        in_time_window("nine", "five")


def test_in_time_window_returns_defer_when_outside() -> None:
    pred = in_time_window("09:00", "17:00")
    fake_now = datetime(2026, 5, 11, 8, 0, tzinfo=timezone.utc)
    ctx = _ctx()
    with mock.patch.object(ctx, "now", return_value=fake_now):
        outcome = pred.evaluate(ctx)
    assert isinstance(outcome, Defer)
    assert outcome.seconds == 3600.0


def test_is_business_hours_returns_defer_on_weekend() -> None:
    pred = is_business_hours(tz=None)
    # 2026-05-09 is a Saturday
    sat = datetime(2026, 5, 9, 12, 0, tzinfo=timezone.utc)
    ctx = _ctx()
    with mock.patch.object(ctx, "now", return_value=sat):
        outcome = pred.evaluate(ctx)
    assert isinstance(outcome, Defer)
    assert outcome.seconds > 0


def test_is_business_hours_allows_during_window() -> None:
    pred = is_business_hours(tz=None)
    # 2026-05-11 is a Monday
    weekday_noon = datetime(2026, 5, 11, 12, 0, tzinfo=timezone.utc)
    ctx = _ctx()
    with mock.patch.object(ctx, "now", return_value=weekday_noon):
        assert pred.evaluate(ctx) is True


def test_is_business_hours_rejects_invalid_window() -> None:
    with pytest.raises(ValueError):
        is_business_hours(start_hour=20, end_hour=10)


def test_is_weekend_uses_utc_by_default() -> None:
    pred = is_weekend()
    sat = datetime(2026, 5, 9, 12, 0, tzinfo=timezone.utc)
    weekday = datetime(2026, 5, 11, 12, 0, tzinfo=timezone.utc)
    ctx = _ctx()
    with mock.patch.object(ctx, "now", return_value=sat):
        assert pred.evaluate(ctx) is True
    with mock.patch.object(ctx, "now", return_value=weekday):
        assert pred.evaluate(ctx) is False


def test_in_timezone_validates_at_construction() -> None:
    in_timezone("UTC")
    with pytest.raises(ValueError):
        in_timezone("Mars/Olympus_Mons")


# -- Attribute recipes ------------------------------------------------------


def test_by_queue_matches_name() -> None:
    assert by_queue("default").evaluate(_ctx()) is True
    assert by_queue("other").evaluate(_ctx()) is False


def test_by_queue_rejects_empty() -> None:
    with pytest.raises(ValueError):
        by_queue("")


def test_by_task_matches_name() -> None:
    assert by_task("t").evaluate(_ctx()) is True
    assert by_task("other").evaluate(_ctx()) is False


def test_by_priority_at_least() -> None:
    pred = by_priority_at_least(5)
    assert pred.evaluate(_ctx(priority=10)) is True
    assert pred.evaluate(_ctx(priority=5)) is True
    assert pred.evaluate(_ctx(priority=4)) is False


def test_retry_count_under_validates() -> None:
    with pytest.raises(ValueError):
        retry_count_under(-1)


def test_retry_count_under_compares_strict() -> None:
    pred = retry_count_under(3)
    assert pred.evaluate(_ctx(retry_count=2)) is True
    assert pred.evaluate(_ctx(retry_count=3)) is False


def test_payload_matches_kwargs() -> None:
    pred = payload_matches("kwargs.tenant", "acme")
    assert pred.evaluate(_ctx(kwargs={"tenant": "acme"})) is True
    assert pred.evaluate(_ctx(kwargs={"tenant": "other"})) is False
    assert pred.evaluate(_ctx(kwargs={})) is False


def test_payload_matches_args_by_index() -> None:
    pred = payload_matches("args.0", "x")
    assert pred.evaluate(_ctx(args=("x", "y"))) is True
    assert pred.evaluate(_ctx(args=("y",))) is False


def test_payload_matches_nested_dict() -> None:
    pred = payload_matches("kwargs.config.region", "us-east")
    assert pred.evaluate(_ctx(kwargs={"config": {"region": "us-east"}})) is True
    assert pred.evaluate(_ctx(kwargs={"config": {"region": "eu-west"}})) is False


def test_payload_matches_rejects_empty_path() -> None:
    with pytest.raises(ValueError):
        payload_matches("", "x")


# -- System-state recipes ---------------------------------------------------


def test_queue_size_under_uses_context_helper() -> None:
    pred = queue_size_under(100)
    ctx = _ctx()
    with mock.patch.object(ctx, "queue_size", return_value=50):
        assert pred.evaluate(ctx) is True
    with mock.patch.object(ctx, "queue_size", return_value=100):
        assert pred.evaluate(ctx) is False


def test_queue_paused_uses_context_helper() -> None:
    pred = queue_paused()
    ctx = _ctx()
    with mock.patch.object(ctx, "queue_paused", return_value=True):
        assert pred.evaluate(ctx) is True
    with mock.patch.object(ctx, "queue_paused", return_value=False):
        assert pred.evaluate(ctx) is False


def test_queue_size_under_rejects_zero() -> None:
    with pytest.raises(ValueError):
        queue_size_under(0)


def test_error_rate_under_allows_with_no_jobs() -> None:
    pred = pred = __import__("taskito.predicates", fromlist=["error_rate_under"]).error_rate_under(
        0.5
    )
    ctx = _ctx()
    with mock.patch.object(ctx, "stats", return_value={}):
        assert pred.evaluate(ctx) is True


def test_error_rate_under_compares_ratio() -> None:
    from taskito.predicates import error_rate_under

    pred = error_rate_under(0.2)
    ctx = _ctx()
    with mock.patch.object(ctx, "stats", return_value={"completed": 90, "failed": 5, "dead": 5}):
        # rate = 10/100 = 0.1 < 0.2
        assert pred.evaluate(ctx) is True
    with mock.patch.object(ctx, "stats", return_value={"completed": 70, "failed": 20, "dead": 10}):
        # rate = 30/100 = 0.3 > 0.2
        assert pred.evaluate(ctx) is False


def test_error_rate_validates_range() -> None:
    from taskito.predicates import error_rate_under

    with pytest.raises(ValueError):
        error_rate_under(0.0)
    with pytest.raises(ValueError):
        error_rate_under(1.5)


# -- Config recipes ---------------------------------------------------------


def test_env_var_truthy_reads_env() -> None:
    pred = env_var_truthy("MY_FLAG")
    with mock.patch.dict(os.environ, {"MY_FLAG": "1"}):
        assert pred.evaluate(_ctx()) is True
    with mock.patch.dict(os.environ, {"MY_FLAG": "no"}):
        assert pred.evaluate(_ctx()) is False
    with mock.patch.dict(os.environ, {}, clear=True):
        assert pred.evaluate(_ctx()) is False


def test_env_var_truthy_rejects_empty_name() -> None:
    with pytest.raises(ValueError):
        env_var_truthy("")


def test_feature_flag_default_provider_reads_ff_prefix() -> None:
    pred = feature_flag("billing")
    with mock.patch.dict(os.environ, {"FF_BILLING": "true"}):
        assert pred.evaluate(_ctx()) is True
    with mock.patch.dict(os.environ, {}, clear=True):
        assert pred.evaluate(_ctx()) is False


def test_feature_flag_custom_provider() -> None:
    class _Stub:
        def __init__(self) -> None:
            self.calls: list[tuple[str, str]] = []

        def is_enabled(self, name: str, ctx: PredicateContext) -> bool:
            self.calls.append((name, ctx.task_name))
            return name == "yes"

    stub: FeatureFlagProvider = _Stub()
    assert feature_flag("yes", provider=stub).evaluate(_ctx()) is True
    assert feature_flag("no", provider=stub).evaluate(_ctx()) is False
    assert stub.calls == [("yes", "t"), ("no", "t")]  # type: ignore[attr-defined]


def test_feature_flag_rejects_empty_name() -> None:
    with pytest.raises(ValueError):
        feature_flag("")
