"""Predicate ABC and composition primitives."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any

from taskito.predicates.outcomes import Cancel, Defer

if TYPE_CHECKING:
    from taskito.predicates.context import PredicateContext


PredicateReturn = bool | Defer | Cancel | Awaitable[Any]
"""What a :meth:`Predicate.evaluate` is allowed to return.

Synchronous predicates return :class:`bool`, :class:`Defer`, or
:class:`Cancel`. Async predicates may also return an awaitable that
resolves to one of those values.
"""


class Predicate(ABC):
    """Base class for task predicates.

    Subclass and implement :meth:`evaluate`. Predicates compose with the
    standard boolean operators::

        @queue.task(predicate=is_business_hours() & ~queue_paused())
        def send_report(): ...

    Composition short-circuits: ``And`` stops at the first non-True,
    ``Or`` stops at the first ``True``. ``Defer`` and ``Cancel`` outcomes
    are propagated unchanged through ``~`` and through ``And``/``Or`` when
    they cannot be overridden by the other operand.
    """

    @abstractmethod
    def evaluate(self, ctx: PredicateContext) -> PredicateReturn:
        """Return ``True`` to allow the job, ``False`` / ``Defer`` / ``Cancel`` to gate it."""

    def __and__(self, other: Predicate) -> Predicate:
        return AndPredicate(self, other)

    def __or__(self, other: Predicate) -> Predicate:
        return OrPredicate(self, other)

    def __invert__(self) -> Predicate:
        return NotPredicate(self)

    def __repr__(self) -> str:
        return f"{type(self).__name__}()"


class AndPredicate(Predicate):
    """Logical AND with short-circuit evaluation."""

    __slots__ = ("_left", "_right")

    def __init__(self, left: Predicate, right: Predicate) -> None:
        self._left = left
        self._right = right

    def evaluate(self, ctx: PredicateContext) -> PredicateReturn:
        # Note: deferred imports avoided. Compose-time evaluation calls
        # _resolve_sync which itself handles awaitables when present.
        from taskito.predicates.evaluate import _resolve_outcome

        left = _resolve_outcome(self._left, ctx)
        if isinstance(left, (Defer, Cancel)) or left is False:
            return left
        return _resolve_outcome(self._right, ctx)

    def __repr__(self) -> str:
        return f"({self._left!r} & {self._right!r})"


class OrPredicate(Predicate):
    """Logical OR with short-circuit evaluation."""

    __slots__ = ("_left", "_right")

    def __init__(self, left: Predicate, right: Predicate) -> None:
        self._left = left
        self._right = right

    def evaluate(self, ctx: PredicateContext) -> PredicateReturn:
        from taskito.predicates.evaluate import _resolve_outcome

        left = _resolve_outcome(self._left, ctx)
        if left is True:
            return True
        right = _resolve_outcome(self._right, ctx)
        if right is True:
            return True
        # Neither side allows. Prefer the most informative gating: Cancel
        # wins over Defer, Defer wins over False.
        if isinstance(left, Cancel) or isinstance(right, Cancel):
            return left if isinstance(left, Cancel) else right
        if isinstance(left, Defer) or isinstance(right, Defer):
            return left if isinstance(left, Defer) else right
        return False

    def __repr__(self) -> str:
        return f"({self._left!r} | {self._right!r})"


class NotPredicate(Predicate):
    """Logical NOT.

    Inverts ``True`` / ``False``. ``Defer`` and ``Cancel`` outcomes pass
    through unchanged — they are terminal, not booleans.
    """

    __slots__ = ("_inner",)

    def __init__(self, inner: Predicate) -> None:
        self._inner = inner

    def evaluate(self, ctx: PredicateContext) -> PredicateReturn:
        from taskito.predicates.evaluate import _resolve_outcome

        outcome = _resolve_outcome(self._inner, ctx)
        if isinstance(outcome, (Defer, Cancel)):
            return outcome
        return not outcome

    def __repr__(self) -> str:
        return f"~{self._inner!r}"


class _CallablePredicate(Predicate):
    """Adapter that wraps a plain callable as a :class:`Predicate`.

    Two signatures are supported:

    * ``Callable[[PredicateContext], bool | Defer | Cancel]`` — receives
      the full context.
    * ``Callable[[str], bool]`` — receives just the task name. Used to
      preserve back-compat with the contrib middleware ``task_filter`` arg.
    """

    __slots__ = ("_fn", "_takes_str")

    def __init__(self, fn: Callable[..., Any], *, takes_str: bool = False) -> None:
        self._fn = fn
        self._takes_str = takes_str

    def evaluate(self, ctx: PredicateContext) -> PredicateReturn:
        if self._takes_str:
            return bool(self._fn(ctx.task_name))
        return self._fn(ctx)  # type: ignore[no-any-return]

    def __repr__(self) -> str:
        return f"callable({getattr(self._fn, '__qualname__', repr(self._fn))})"


def coerce_predicate(
    value: Predicate | Callable[..., Any] | None,
    *,
    str_callable: bool = False,
) -> Predicate | None:
    """Wrap a callable as a :class:`Predicate`. ``None`` passes through.

    Use ``str_callable=True`` to accept the legacy ``Callable[[str], bool]``
    contrib ``task_filter`` shape.
    """
    if value is None:
        return None
    if isinstance(value, Predicate):
        return value
    if callable(value):
        return _CallablePredicate(value, takes_str=str_callable)
    raise TypeError(
        f"predicate must be a Predicate, callable, or None; got {type(value).__name__}"
    )
