"""Approval gate handling: enter, timeout."""

from __future__ import annotations

import logging
import threading
from typing import TYPE_CHECKING

from taskito.events import EventType
from taskito.workflows.types import GateAction

if TYPE_CHECKING:
    from taskito.workflows.tracker.tracker import WorkflowTracker
    from taskito.workflows.tracker.types import _RunConfig


logger = logging.getLogger("taskito.workflows")


def enter_gate(tracker: WorkflowTracker, run_id: str, node_name: str, config: _RunConfig) -> None:
    """Transition a gate node to WAITING_APPROVAL and start timeout."""
    try:
        tracker._queue._inner.set_workflow_node_waiting_approval(run_id, node_name)
    except (RuntimeError, ValueError):
        logger.exception("set_workflow_node_waiting_approval failed for %s", node_name)
        return
    config.deferred_nodes.discard(node_name)

    gate = config.gate_configs[node_name]
    try:
        tracker._queue._emit_event(
            EventType.WORKFLOW_GATE_REACHED,
            {
                "run_id": run_id,
                "node_name": node_name,
                "message": gate.message if isinstance(gate.message, str) else None,
            },
        )
    except Exception:
        logger.exception("failed to emit WORKFLOW_GATE_REACHED")

    if gate.timeout is not None and gate.timeout > 0:
        timer = threading.Timer(
            gate.timeout,
            on_gate_timeout,
            args=(tracker, run_id, node_name, gate.on_timeout),
        )
        timer.daemon = True
        with tracker._state_lock:
            tracker._gate_timers[(run_id, node_name)] = timer
        timer.start()


def on_gate_timeout(
    tracker: WorkflowTracker, run_id: str, node_name: str, action: GateAction
) -> None:
    """Handle gate timeout expiry."""
    with tracker._state_lock:
        # If the run was cleaned up (e.g., cancelled before timeout fired),
        # the timer entry was already removed by `_cleanup_run` — stop.
        if (run_id, node_name) not in tracker._gate_timers:
            return
        tracker._gate_timers.pop((run_id, node_name), None)
    approved = action is GateAction.APPROVE
    error = None if approved else "gate timeout"
    tracker.resolve_gate(run_id, node_name, approved=approved, error=error)
