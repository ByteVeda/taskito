"""Resource definition and scope types."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class ResourceScope(Enum):
    """Lifecycle scope for a resource instance."""

    WORKER = "worker"  # shared across all tasks, lives for worker lifetime
    TASK = "task"  # acquired per-task from a pool, returned after
    THREAD = "thread"  # one instance per worker thread, created lazily
    REQUEST = "request"  # fresh instance per task, torn down after


@dataclass
class ResourceDefinition:
    """Describes how to create, health-check, and tear down a resource."""

    name: str
    factory: Callable[..., Any]
    teardown: Callable | None = None
    health_check: Callable | None = None
    health_check_interval: float = 0.0  # seconds, 0 = disabled
    max_recreation_attempts: int = 3
    scope: ResourceScope = ResourceScope.WORKER
    depends_on: list[str] = field(default_factory=list)
    # Pool config (task scope only)
    pool_size: int | None = None  # None = worker thread count
    pool_min: int = 0
    acquire_timeout: float = 10.0
    max_lifetime: float = 3600.0
    idle_timeout: float = 300.0
    # Behavior flags
    reloadable: bool = False
    frozen: bool = False
