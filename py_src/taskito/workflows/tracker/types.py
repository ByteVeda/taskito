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
    # Maps step_name -> compensation_task_name. Populated from the
    # workflow's compiled compensation map at submit time. Empty when the
    # workflow has no saga steps.
    compensation_map: dict[str, str] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.compensation_map is None:
            self.compensation_map = {}
