"""Time-based predicates.

All recipes work with timezone-aware datetimes. ``tz`` arguments accept an
IANA timezone string (e.g. ``"US/Pacific"``); ``None`` means UTC.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

from taskito.predicates.core import Predicate
from taskito.predicates.outcomes import Defer

if TYPE_CHECKING:
    from taskito.predicates.context import PredicateContext

try:
    from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

    _HAS_ZONEINFO = True
except ImportError:  # pragma: no cover - zoneinfo is stdlib on 3.9+
    _HAS_ZONEINFO = False

    class ZoneInfoNotFoundError(Exception):  # type: ignore[no-redef]
        pass


_ONE_DAY = timedelta(days=1)


def _resolve_tz(tz: str | None) -> timezone:
    """Resolve a tz string to a ``tzinfo``-compatible object."""
    if tz is None:
        return timezone.utc
    if not _HAS_ZONEINFO:
        raise RuntimeError("zoneinfo is not available; pass tz=None or install Python 3.9+")
    try:
        return ZoneInfo(tz)  # type: ignore[return-value]
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"unknown timezone: {tz!r}") from exc


def _seconds_until_window(now_local: datetime, start_hour: int, start_minute: int) -> float:
    """Seconds from ``now_local`` until the next occurrence of (h, m)."""
    target = now_local.replace(hour=start_hour, minute=start_minute, second=0, microsecond=0)
    if target <= now_local:
        target = target + _ONE_DAY
    return max(1.0, (target - now_local).total_seconds())


@dataclass(frozen=True)
class _IsBusinessHours(Predicate):
    """True Mon-Fri between 09:00 and 17:00 in the configured timezone."""

    start_hour: int = 9
    end_hour: int = 17
    tz: str | None = None
    weekdays_only: bool = True

    def evaluate(self, ctx: PredicateContext) -> bool | Defer:
        tz_info = _resolve_tz(self.tz)
        local = ctx.now().astimezone(tz_info)
        if self.weekdays_only and local.weekday() >= 5:
            # Sat / Sun → defer until Monday at start_hour
            days_to_monday = 7 - local.weekday()
            defer = local.replace(
                hour=self.start_hour, minute=0, second=0, microsecond=0
            ) + timedelta(days=days_to_monday)
            return Defer(seconds=max(1.0, (defer - local).total_seconds()))
        if local.hour < self.start_hour:
            return Defer(seconds=_seconds_until_window(local, self.start_hour, 0))
        if local.hour >= self.end_hour:
            # Defer to next day at start_hour
            next_day = local + _ONE_DAY
            target = next_day.replace(hour=self.start_hour, minute=0, second=0, microsecond=0)
            return Defer(seconds=max(1.0, (target - local).total_seconds()))
        return True


def is_business_hours(
    start_hour: int = 9,
    end_hour: int = 17,
    *,
    tz: str | None = None,
    weekdays_only: bool = True,
) -> Predicate:
    """Allow only during business hours; otherwise :class:`Defer` to the next window.

    Defaults to 09:00-17:00 Mon-Fri in UTC. Pass ``tz="US/Pacific"`` (or
    any IANA name) for a local-time window.
    """
    if not 0 <= start_hour < 24 or not 0 < end_hour <= 24 or start_hour >= end_hour:
        raise ValueError(f"invalid business-hours window: {start_hour}-{end_hour}")
    return _IsBusinessHours(
        start_hour=start_hour, end_hour=end_hour, tz=tz, weekdays_only=weekdays_only
    )


@dataclass(frozen=True)
class _IsWeekend(Predicate):
    tz: str | None = None

    def evaluate(self, ctx: PredicateContext) -> bool:
        tz_info = _resolve_tz(self.tz)
        local = ctx.now().astimezone(tz_info)
        return local.weekday() >= 5


def is_weekend(*, tz: str | None = None) -> Predicate:
    """True on Saturday or Sunday in the configured timezone."""
    return _IsWeekend(tz=tz)


@dataclass(frozen=True)
class _InTimeWindow(Predicate):
    start_hour: int
    start_minute: int
    end_hour: int
    end_minute: int
    tz: str | None = None

    def evaluate(self, ctx: PredicateContext) -> bool | Defer:
        tz_info = _resolve_tz(self.tz)
        local = ctx.now().astimezone(tz_info)
        start_minutes = self.start_hour * 60 + self.start_minute
        end_minutes = self.end_hour * 60 + self.end_minute
        cur_minutes = local.hour * 60 + local.minute
        if start_minutes <= cur_minutes < end_minutes:
            return True
        if cur_minutes < start_minutes:
            return Defer(seconds=(start_minutes - cur_minutes) * 60.0)
        # past end — defer to tomorrow's start
        next_day = local + _ONE_DAY
        target = next_day.replace(
            hour=self.start_hour, minute=self.start_minute, second=0, microsecond=0
        )
        return Defer(seconds=max(1.0, (target - local).total_seconds()))


def in_time_window(start: str, end: str, *, tz: str | None = None) -> Predicate:
    """Allow during ``[start, end)`` in the configured timezone; defer otherwise.

    ``start`` and ``end`` are ``"HH:MM"`` strings. End is exclusive.
    """
    sh, sm = _parse_hhmm(start)
    eh, em = _parse_hhmm(end)
    if (sh, sm) >= (eh, em):
        raise ValueError(f"start ({start}) must be before end ({end})")
    return _InTimeWindow(start_hour=sh, start_minute=sm, end_hour=eh, end_minute=em, tz=tz)


def _parse_hhmm(value: str) -> tuple[int, int]:
    parts = value.split(":")
    if len(parts) != 2:
        raise ValueError(f"expected 'HH:MM', got {value!r}")
    try:
        h, m = int(parts[0]), int(parts[1])
    except ValueError as exc:
        raise ValueError(f"expected 'HH:MM', got {value!r}") from exc
    if not 0 <= h <= 23 or not 0 <= m <= 59:
        raise ValueError(f"hour/minute out of range: {value!r}")
    return h, m


@dataclass(frozen=True)
class _After(Predicate):
    target: datetime

    def evaluate(self, ctx: PredicateContext) -> bool | Defer:
        now = ctx.now()
        if now >= self.target:
            return True
        return Defer(seconds=(self.target - now).total_seconds())


def after(target: datetime) -> Predicate:
    """Allow only when wall-clock time is at or past ``target``."""
    if target.tzinfo is None:
        target = target.replace(tzinfo=timezone.utc)
    return _After(target=target)


@dataclass(frozen=True)
class _Before(Predicate):
    target: datetime

    def evaluate(self, ctx: PredicateContext) -> bool:
        return ctx.now() < self.target


def before(target: datetime) -> Predicate:
    """Allow only when wall-clock time is strictly before ``target``."""
    if target.tzinfo is None:
        target = target.replace(tzinfo=timezone.utc)
    return _Before(target=target)


@dataclass(frozen=True)
class _InTimezone(Predicate):
    """Validates that the recipe-configured timezone resolves on this host.

    Returns ``True`` unconditionally — useful as a composable building
    block when paired with other time predicates. The cheaper alternative
    is to call :func:`_resolve_tz` at recipe-construction time, which is
    what this does.
    """

    tz: str

    def evaluate(self, ctx: PredicateContext) -> bool:
        return True


def in_timezone(tz: str) -> Predicate:
    """No-op predicate that validates ``tz`` resolves on this host.

    Mostly useful as a guard at decoration time: passing an unknown tz
    here raises immediately rather than at first execution.
    """
    _resolve_tz(tz)
    return _InTimezone(tz=tz)
