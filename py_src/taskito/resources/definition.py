"""Resource definition and scope types."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable


class ResourceScope(Enum):
    """Lifecycle scope for a resource instance."""

    WORKER = "worker"  # shared across all tasks, lives for worker lifetime


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
