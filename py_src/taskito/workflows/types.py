"""Type definitions for workflow state and node snapshots."""

from __future__ import annotations

import enum
from dataclasses import dataclass, field


class WorkflowState(str, enum.Enum):
    """Terminal and intermediate states of a workflow run."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    PAUSED = "paused"

    def is_terminal(self) -> bool:
        return self in (WorkflowState.COMPLETED, WorkflowState.FAILED, WorkflowState.CANCELLED)


class NodeStatus(str, enum.Enum):
    """Status of a single workflow node (step)."""

    PENDING = "pending"
    READY = "ready"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"
    WAITING_APPROVAL = "waiting_approval"
    CACHE_HIT = "cache_hit"

    def is_terminal(self) -> bool:
        return self in (
            NodeStatus.COMPLETED,
            NodeStatus.FAILED,
            NodeStatus.SKIPPED,
            NodeStatus.CACHE_HIT,
        )


@dataclass
class NodeSnapshot:
    """Snapshot of a single workflow node's execution state."""

    name: str
    status: NodeStatus
    job_id: str | None = None
    error: str | None = None


@dataclass
class WorkflowStatus:
    """Snapshot of a workflow run's overall state plus per-node details."""

    run_id: str
    state: WorkflowState
    started_at: int | None = None
    completed_at: int | None = None
    error: str | None = None
    nodes: dict[str, NodeSnapshot] = field(default_factory=dict)
