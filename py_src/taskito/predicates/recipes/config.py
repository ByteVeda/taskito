"""Predicates that consult external configuration (env vars, feature flags)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import TYPE_CHECKING

from taskito.predicates.core import Predicate
from taskito.predicates.providers import (
    FeatureFlagProvider,
    env_feature_flag_provider,
)

if TYPE_CHECKING:
    from taskito.predicates.context import PredicateContext


_TRUTHY = frozenset({"1", "true", "t", "yes", "y", "on"})


@dataclass(frozen=True)
class _EnvVarTruthy(Predicate):
    name: str

    def evaluate(self, ctx: PredicateContext) -> bool:
        return os.environ.get(self.name, "").strip().lower() in _TRUTHY


def env_var_truthy(name: str) -> Predicate:
    """Allow when env var ``name`` is set to ``1``/``true``/``yes``/``on``."""
    if not name:
        raise ValueError("env var name must be non-empty")
    return _EnvVarTruthy(name=name)


@dataclass(frozen=True)
class _FeatureFlag(Predicate):
    flag: str
    provider: FeatureFlagProvider

    def evaluate(self, ctx: PredicateContext) -> bool:
        return bool(self.provider.is_enabled(self.flag, ctx))


def feature_flag(name: str, *, provider: FeatureFlagProvider | None = None) -> Predicate:
    """Allow when feature flag ``name`` is enabled.

    Defaults to an env-var-backed provider with prefix ``FF_`` (e.g.
    ``feature_flag("new-billing")`` reads ``FF_NEW-BILLING``). Pass a
    custom provider to integrate LaunchDarkly, Statsig, etc.
    """
    if not name:
        raise ValueError("flag name must be non-empty")
    return _FeatureFlag(flag=name, provider=provider or env_feature_flag_provider())
