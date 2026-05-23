"""Workflow completion tracker — main class and orchestration.

Subscribes to terminal job events (``JOB_COMPLETED``, ``JOB_FAILED``,
``JOB_DEAD``, ``JOB_CANCELLED``) and forwards workflow-related ones to the
Rust ``mark_workflow_node_result`` entry point. When a run reaches a terminal
state, emits a workflow-level event and releases any threads blocked on
``WorkflowRun.wait``.

For workflows that contain fan-out / fan-in steps, conditions, or
``on_failure="continue"``, the tracker orchestrates dynamic job creation,
condition evaluation, and selective skip propagation. Concern-specific
helpers live in ``dag``, ``gates``, ``sub_workflows``, and ``fan_out`` and
are invoked from this orchestrator.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from taskito.events import EventType
from taskito.workflows.saga import SagaOrchestrator
from taskito.workflows.tracker import dag, fan_out, gates, sub_workflows
from taskito.workflows.tracker.types import _RunConfig

if TYPE_CHECKING:
    from taskito.app import Queue


logger = logging.getLogger("taskito.workflows")


class WorkflowTracker:
    """Bridges taskito job events to workflow run state transitions."""

    def __init__(self, queue: Queue):
        self._queue = queue
        self._waiters_lock = threading.Lock()
        self._waiters: dict[str, list[threading.Event]] = {}
        self._event_bus = queue._event_bus
        # `_state_lock` guards every read and write of `_run_configs`,
        # `_job_to_run`, `_child_to_parent`, and `_gate_timers`. These dicts
        # are accessed from worker threads (event bus), timer threads
        # (gate timeouts), and user threads (approve_gate/reject_gate).
        # A single lock is simple and adequate; tracker operations are short.
        self._state_lock = threading.RLock()
        self._run_configs: dict[str, _RunConfig] = {}
        self._job_to_run: dict[str, str] = {}
        # Steps per run, captured at register-run time. Needed at saga start
        # to compute reverse topological waves of the compensable nodes.
        self._run_steps: dict[str, dict[str, Any]] = {}
        self._gate_timers: dict[tuple[str, str], threading.Timer] = {}
        self._child_to_parent: dict[str, tuple[str, str]] = {}
        # Saga orchestrator — driven by the failure path in `_handle`.
        self._saga = SagaOrchestrator(queue)
        self._install_listeners()

    def _install_listeners(self) -> None:
        self._event_bus.on(EventType.JOB_COMPLETED, self._on_success)
        self._event_bus.on(EventType.JOB_FAILED, self._on_failure)
        self._event_bus.on(EventType.JOB_DEAD, self._on_failure)
        self._event_bus.on(EventType.JOB_CANCELLED, self._on_cancelled)
        # Sub-workflow completion events.
        self._event_bus.on(EventType.WORKFLOW_COMPLETED, self._on_child_workflow_terminal)
        self._event_bus.on(EventType.WORKFLOW_FAILED, self._on_child_workflow_terminal)
        self._event_bus.on(EventType.WORKFLOW_CANCELLED, self._on_child_workflow_terminal)
        # Saga terminal events — release waiters when compensation finishes.
        self._event_bus.on(EventType.WORKFLOW_COMPENSATED, self._on_saga_terminal)
        self._event_bus.on(EventType.WORKFLOW_COMPENSATION_FAILED, self._on_saga_terminal)

    def _on_saga_terminal(self, _event_type: EventType, payload: dict[str, Any]) -> None:
        run_id = payload.get("workflow_run_id")
        if not run_id:
            return
        self._release_waiters(run_id)
        self._cleanup_run(run_id)

    # ── Wait management ────────────────────────────────────────────

    def register_wait(self, run_id: str) -> threading.Event:
        """Return an event that will be set when ``run_id`` reaches a terminal state."""
        event = threading.Event()
        with self._waiters_lock:
            self._waiters.setdefault(run_id, []).append(event)
        return event

    def unregister_wait(self, run_id: str, event: threading.Event) -> None:
        with self._waiters_lock:
            entries = self._waiters.get(run_id)
            if not entries:
                return
            try:
                entries.remove(event)
            except ValueError:
                return
            if not entries:
                self._waiters.pop(run_id, None)

    def _release_waiters(self, run_id: str) -> None:
        with self._waiters_lock:
            entries = self._waiters.pop(run_id, [])
        for event in entries:
            event.set()

    # ── Dynamic run registration ───────────────────────────────────

    def register_run(
        self,
        run_id: str,
        step_metadata_json: str,
        dag_bytes: bytes | list[int],
        deferred_nodes: list[str],
        deferred_payloads: dict[str, bytes],
        on_failure: str = "fail_fast",
        callable_conditions: dict[str, Callable[..., bool]] | None = None,
        gate_configs: dict[str, Any] | None = None,
        sub_workflow_refs: dict[str, Any] | None = None,
        compensation_map: dict[str, str] | None = None,
        steps: dict[str, Any] | None = None,
        compensate_on_continue: bool = False,
    ) -> None:
        """Cache configuration for a tracker-managed workflow run."""
        meta: dict[str, dict[str, Any]] = json.loads(step_metadata_json)
        successors, predecessors = dag.build_dag_maps(dag_bytes)
        config = _RunConfig(
            step_metadata=meta,
            successors=successors,
            predecessors=predecessors,
            deferred_nodes=set(deferred_nodes),
            deferred_payloads=deferred_payloads,
            on_failure=on_failure,
            callable_conditions=callable_conditions or {},
            gate_configs=gate_configs or {},
            sub_workflow_refs=sub_workflow_refs or {},
            compensation_map=compensation_map or {},
            compensate_on_continue=compensate_on_continue,
        )
        with self._state_lock:
            self._run_configs[run_id] = config
            if steps is not None:
                self._run_steps[run_id] = steps

        # Populate job→run mapping for initial nodes.
        try:
            raw = self._queue._inner.get_workflow_run_status(run_id)
        except (RuntimeError, ValueError):
            logger.exception("failed to read workflow run status for %s", run_id)
        else:
            with self._state_lock:
                for _name, info in raw.node_statuses().items():
                    jid = info.get("job_id")
                    if jid:
                        self._job_to_run[jid] = run_id

        # Evaluate root deferred nodes (those with no predecessors).
        self._evaluate_root_deferred(run_id, config)

    def _evaluate_root_deferred(self, run_id: str, config: _RunConfig) -> None:
        """Immediately evaluate deferred root nodes (no predecessors)."""
        for node_name in list(config.deferred_nodes):
            preds = config.predecessors.get(node_name, [])
            if preds:
                continue  # Not a root node.
            meta = config.step_metadata.get(node_name)
            if meta is None:
                continue
            if node_name in config.gate_configs:
                gates.enter_gate(self, run_id, node_name, config)
            elif node_name in config.sub_workflow_refs:
                sub_workflows.submit_sub_workflow(self, run_id, node_name, config)
            elif meta.get("fan_out") is None and meta.get("fan_in") is None:
                dag.create_deferred_job_for_node(self, run_id, node_name, config)

    # ── Event handlers ─────────────────────────────────────────────

    def _on_success(self, _event_type: EventType, payload: dict[str, Any]) -> None:
        self._handle(payload, succeeded=True, error=None)

    def _on_failure(self, _event_type: EventType, payload: dict[str, Any]) -> None:
        self._handle(payload, succeeded=False, error=payload.get("error"))

    def _on_cancelled(self, _event_type: EventType, payload: dict[str, Any]) -> None:
        self._handle(payload, succeeded=False, error="cancelled")

    def _handle(
        self,
        payload: dict[str, Any],
        *,
        succeeded: bool,
        error: str | None,
    ) -> None:
        job_id = payload.get("job_id")
        if not job_id:
            return

        # Compensation jobs flow through a different code path — the saga
        # orchestrator owns their lifecycle, not the normal tracker.
        if self._saga.is_compensation_job(job_id):
            self._saga.on_compensation_completed(job_id=job_id, succeeded=succeeded, error=error)
            return

        # Determine if this job belongs to a managed run.
        with self._state_lock:
            run_id = self._job_to_run.get(job_id)
            config = self._run_configs.get(run_id) if run_id else None
        skip_cascade = config is not None

        # Compute result hash for successful completions.
        rh: str | None = None
        if succeeded:
            rh = self._compute_result_hash(job_id)

        try:
            result = self._queue._inner.mark_workflow_node_result(
                job_id, succeeded, error, skip_cascade, rh
            )
        except (RuntimeError, ValueError) as exc:
            logger.exception("mark_workflow_node_result failed for job %s", job_id)
            # Notify any waiters so they don't block forever on a silent failure.
            if run_id is not None:
                self._emit_terminal(run_id, "failed", str(exc))
                self._cleanup_run(run_id)
            return

        if result is None:
            return

        run_id, node_name, terminal_state = result

        # Track partial failure occurrence for continue-mode saga finalization.
        # This is the only place we observe individual job-failure events in
        # the tracker — we record it on the in-memory config so that
        # _try_finalize / the terminal-handler below can decide whether to
        # transition the run to CompletedWithFailures instead of Failed.
        if not succeeded and config is not None and config.on_failure == "continue":
            with self._state_lock:
                config.partial_failure_occurred = True

        if terminal_state is not None:
            # Continue-mode partial-failure override: when at least one node
            # succeeded AND at least one failed AND the user opted into
            # compensation via compensate_on_continue=True, transition the
            # run to CompletedWithFailures (instead of the default Failed)
            # and hand off to the saga orchestrator. The CompletedWithFailures
            # state is itself a valid pre-compensation state — see
            # WorkflowState::can_transition_to in Rust.
            override_to_completed_with_failures = (
                terminal_state == "failed"
                and config is not None
                and config.on_failure == "continue"
                and config.compensate_on_continue
                and config.partial_failure_occurred
            )
            if override_to_completed_with_failures:
                try:
                    self._queue._inner.set_workflow_run_completed_with_failures(run_id)
                except (RuntimeError, ValueError):
                    logger.exception(
                        "set_workflow_run_completed_with_failures failed for %s", run_id
                    )
                else:
                    terminal_state = "completed_with_failures"

            # Hand off to the saga orchestrator when:
            #   - on_failure="fail_fast" and the run failed, OR
            #   - on_failure="continue" with compensate_on_continue=True and
            #     the run finalised with at least one failed node.
            # The orchestrator decides eligibility internally (checks for
            # explicit compensation_map or sub-workflow propagation) and
            # emits its own terminal event when compensation finishes.
            if config is not None and (
                (terminal_state == "failed" and config.on_failure == "fail_fast")
                or (terminal_state == "completed_with_failures" and config.compensate_on_continue)
            ):
                steps = self._run_steps.get(run_id, {})
                started = self._saga.start_compensation(run_id, config, steps)
                if started:
                    # The saga owns the run from here. Don't clean up yet —
                    # the orchestrator will call back when it finishes.
                    return

            self._emit_terminal(run_id, terminal_state, error)
            self._cleanup_run(run_id)
            return

        # Re-fetch config now that we have the definitive run_id.
        if config is None:
            with self._state_lock:
                config = self._run_configs.get(run_id)
        if config is None:
            return  # Static workflow — Rust cascade handled everything.

        # Fan-out child handling.
        if "[" in node_name:
            if succeeded:
                fan_out.handle_fan_out_child(self, run_id, node_name, config)
            else:
                fan_out.handle_fan_out_child_failure(self, run_id, node_name, config)
            return

        # Fan-out expansion trigger (only on success).
        if succeeded:
            fan_out.maybe_trigger_fan_out(self, run_id, node_name, job_id, config)

        # Evaluate successors with conditions.
        self._evaluate_successors(run_id, node_name, config)

    # ── Successor evaluation ───────────────────────────────────────

    def _evaluate_successors(self, run_id: str, completed_node: str, config: _RunConfig) -> None:
        """Evaluate and create/skip deferred successor nodes."""
        for successor in config.successors.get(completed_node, []):
            if successor not in config.deferred_nodes:
                continue
            meta = config.step_metadata.get(successor)
            if meta is None:
                continue

            if not dag.all_predecessors_terminal(self, run_id, successor, config):
                continue

            # Fan-out/fan-in nodes: only skip them here (expansion is
            # handled by maybe_trigger_fan_out / handle_fan_out_child).
            if meta.get("fan_out") is not None or meta.get("fan_in") is not None:
                if not dag.should_execute(self, run_id, successor, config):
                    dag.skip_and_propagate(self, run_id, successor, config)
                continue

            if not dag.should_execute(self, run_id, successor, config):
                dag.skip_and_propagate(self, run_id, successor, config)
                continue

            # Gate nodes pause for approval instead of creating a job.
            if successor in config.gate_configs:
                gates.enter_gate(self, run_id, successor, config)
            elif successor in config.sub_workflow_refs:
                sub_workflows.submit_sub_workflow(self, run_id, successor, config)
            else:
                dag.create_deferred_job_for_node(self, run_id, successor, config)

        # After evaluating successors, check if the run is now terminal.
        self._try_finalize(run_id)

    # ── Terminal state ─────────────────────────────────────────────

    def _emit_terminal(self, run_id: str, terminal_state: str, error: str | None) -> None:
        workflow_event = dag.final_state_to_event(terminal_state)
        if workflow_event is not None:
            try:
                self._queue._emit_event(
                    workflow_event,
                    {"run_id": run_id, "state": terminal_state, "error": error},
                )
            except Exception:
                logger.exception("failed to emit %s", workflow_event)
        self._release_waiters(run_id)

    def _cleanup_run(self, run_id: str) -> None:
        """Drop all tracker state tied to ``run_id`` and cancel any live timers.

        When the run is a sub-workflow child whose parent is still being
        tracked, ``_run_configs`` and ``_run_steps`` are *retained* so the
        parent's saga orchestrator can propagate compensation into the
        child later. The parent's own cleanup sweeps these entries when it
        finalises (see ``stale_child_ids`` below).
        """
        with self._state_lock:
            parent_still_alive = False
            parent_link = self._child_to_parent.get(run_id)
            if parent_link is not None:
                parent_run_id = parent_link[0]
                parent_still_alive = parent_run_id in self._run_configs

            if parent_still_alive:
                # Keep config + steps so the parent can propagate compensation.
                # Drop transient state (job→run map entries, gate timers) so
                # the worker doesn't keep routing fan-out / gate events to a
                # finished child.
                self._job_to_run = {
                    jid: rid for jid, rid in self._job_to_run.items() if rid != run_id
                }
                stale_timer_keys = [k for k in self._gate_timers if k[0] == run_id]
                for key in stale_timer_keys:
                    timer = self._gate_timers.pop(key, None)
                    if timer is not None:
                        timer.cancel()
                return

            self._run_configs.pop(run_id, None)
            self._run_steps.pop(run_id, None)
            self._job_to_run = {jid: rid for jid, rid in self._job_to_run.items() if rid != run_id}
            stale_timer_keys = [k for k in self._gate_timers if k[0] == run_id]
            for key in stale_timer_keys:
                timer = self._gate_timers.pop(key, None)
                if timer is not None:
                    timer.cancel()
            stale_child_ids = [
                cid for cid, (prid, _) in self._child_to_parent.items() if prid == run_id
            ]
            for cid in stale_child_ids:
                self._child_to_parent.pop(cid, None)
                # Children whose cleanup we deferred (because the parent was
                # still alive) get swept here on parent finalization.
                self._run_configs.pop(cid, None)
                self._run_steps.pop(cid, None)

    def _try_finalize(self, run_id: str) -> None:
        """If all nodes are terminal, finalize the run and emit the event."""
        try:
            terminal_state = self._queue._inner.finalize_run_if_terminal(run_id)
        except (RuntimeError, ValueError):
            logger.exception("finalize_run_if_terminal failed for %s", run_id)
            return
        if terminal_state is None:
            return

        with self._state_lock:
            config = self._run_configs.get(run_id)

        # Continue-mode partial-failure override + compensation hand-off.
        # Mirrors the logic in _handle() so fan-out and sub-workflow paths
        # also surface CompletedWithFailures correctly.
        if (
            terminal_state == "failed"
            and config is not None
            and config.on_failure == "continue"
            and config.compensate_on_continue
            and config.partial_failure_occurred
        ):
            try:
                self._queue._inner.set_workflow_run_completed_with_failures(run_id)
            except (RuntimeError, ValueError):
                logger.exception("set_workflow_run_completed_with_failures failed for %s", run_id)
            else:
                terminal_state = "completed_with_failures"

        if config is not None and (
            (terminal_state == "failed" and config.on_failure == "fail_fast")
            or (terminal_state == "completed_with_failures" and config.compensate_on_continue)
        ):
            steps = self._run_steps.get(run_id, {})
            started = self._saga.start_compensation(run_id, config, steps)
            if started:
                return

        self._emit_terminal(run_id, terminal_state, None)
        self._cleanup_run(run_id)

    # ── Gate resolution (public API) ───────────────────────────────

    def resolve_gate(
        self,
        run_id: str,
        node_name: str,
        *,
        approved: bool,
        error: str | None = None,
    ) -> None:
        """Approve or reject a gate, resuming the workflow."""
        with self._state_lock:
            timer = self._gate_timers.pop((run_id, node_name), None)
            config = self._run_configs.get(run_id)
        if timer is not None:
            timer.cancel()

        try:
            self._queue._inner.resolve_workflow_gate(run_id, node_name, approved, error)
        except (RuntimeError, ValueError):
            logger.exception("resolve_workflow_gate failed for %s", node_name)
            return

        if config is not None:
            self._evaluate_successors(run_id, node_name, config)
            self._try_finalize(run_id)

    # ── Sub-workflow listener ──────────────────────────────────────

    def _on_child_workflow_terminal(self, _event_type: EventType, payload: dict[str, Any]) -> None:
        """Handle child workflow completion → update parent node.

        The ``_child_to_parent`` link is *not* popped here — it stays in
        place until the parent run finalises (or until the parent's saga
        orchestrator has had a chance to propagate compensation into the
        child). The parent's ``_cleanup_run`` sweeps stale links.
        """
        child_run_id = payload.get("run_id")
        if not child_run_id:
            return
        with self._state_lock:
            parent_info = self._child_to_parent.get(child_run_id)
        if parent_info is None:
            return  # Not a sub-workflow child.

        parent_run_id, parent_node_name = parent_info
        state = payload.get("state", "")
        succeeded = state == "completed"

        try:
            self._queue._inner.resolve_workflow_gate(
                parent_run_id,
                parent_node_name,
                succeeded,
                payload.get("error") if not succeeded else None,
            )
        except (RuntimeError, ValueError):
            logger.exception(
                "failed to update parent node %s for child %s",
                parent_node_name,
                child_run_id,
            )
            return

        with self._state_lock:
            config = self._run_configs.get(parent_run_id)
        if config is not None:
            self._evaluate_successors(parent_run_id, parent_node_name, config)
            self._try_finalize(parent_run_id)

    # ── Result helpers ─────────────────────────────────────────────

    def _fetch_result(self, job_id: str) -> Any:
        """Fetch and deserialize a job's result, with polling for DB write lag."""
        for _ in range(50):
            py_job = self._queue._inner.get_job(job_id)
            if py_job is not None:
                rb = py_job.result_bytes
                if rb is not None:
                    return self._queue._serializer.loads(rb)
            time.sleep(0.1)
        return None

    def _compute_result_hash(self, job_id: str) -> str | None:
        """Compute SHA-256 of a completed job's result bytes.

        Best-effort: if the result isn't stored yet (event fires before
        DB write), returns ``None``. The hash is only used for incremental
        caching, not correctness.
        """
        py_job = self._queue._inner.get_job(job_id)
        if py_job is not None:
            rb = py_job.result_bytes
            if rb is not None:
                return hashlib.sha256(rb).hexdigest()
        return None
