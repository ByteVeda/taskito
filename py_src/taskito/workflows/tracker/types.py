"""Shared workflow tracker dataclasses."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


@dataclass
class _RunConfig:
    """In-memory configuration for a tracker-managed workflow run."""

    step_metadata: dict[str, dict[str, Any]]
    successors: dict[str, list[str]]
    predecessors: dict[str, list[str]]
    deferred_nodes: set[str]
    deferred_payloads: dict[str, bytes]
    on_failure: str
    callable_conditions: dict[str, Callable[..., bool]]
    gate_configs: dict[str, Any]
    sub_workflow_refs: dict[str, Any]
