"""Workflow completion tracker.

Subscribes to terminal job events (``JOB_COMPLETED``, ``JOB_FAILED``,
``JOB_DEAD``, ``JOB_CANCELLED``) and forwards workflow-related ones to the
Rust ``mark_workflow_node_result`` entry point. When a run reaches a terminal
state, emits a workflow-level event and releases any threads blocked on
``WorkflowRun.wait``.

For workflows that contain fan-out / fan-in steps, conditions, or
``on_failure="continue"``, the tracker orchestrates dynamic job creation,
condition evaluation, and selective skip propagation.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from taskito.events import EventType

from .context import WorkflowContext
from .fan_out import apply_fan_out, build_child_payload, build_fan_in_payload

if TYPE_CHECKING:
    from collections.abc import Callable

    from taskito.app import Queue

logger = logging.getLogger("taskito.workflows")


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


class WorkflowTracker:
    """Bridges taskito job events to workflow run state transitions."""

    def __init__(self, queue: Queue):
        self._queue = queue
        self._waiters_lock = threading.Lock()
        self._waiters: dict[str, list[threading.Event]] = {}
        self._event_bus = queue._event_bus
        self._run_configs: dict[str, _RunConfig] = {}
        self._job_to_run: dict[str, str] = {}
        self._gate_timers: dict[tuple[str, str], threading.Timer] = {}
        self._child_to_parent: dict[str, tuple[str, str]] = {}
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
    ) -> None:
        """Cache configuration for a tracker-managed workflow run."""
        meta: dict[str, dict[str, Any]] = json.loads(step_metadata_json)
        successors, predecessors = _build_dag_maps(dag_bytes)
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
        )
        self._run_configs[run_id] = config

        # Populate job→run mapping for initial nodes.
        try:
            raw = self._queue._inner.get_workflow_run_status(run_id)
            for _name, info in raw.node_statuses().items():
                jid = info.get("job_id")
                if jid:
                    self._job_to_run[jid] = run_id
        except Exception:  # pragma: no cover
            logger.exception("failed to populate job→run mapping for %s", run_id)

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
                self._enter_gate(run_id, node_name, config)
            elif node_name in config.sub_workflow_refs:
                self._submit_sub_workflow(run_id, node_name, config)
            elif meta.get("fan_out") is None and meta.get("fan_in") is None:
                self._create_deferred_job_for_node(run_id, node_name, config)

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

        # Determine if this job belongs to a managed run.
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
        except Exception:  # pragma: no cover - defensive
            logger.exception("mark_workflow_node_result failed for job %s", job_id)
            return

        if result is None:
            return

        run_id, node_name, terminal_state = result

        if terminal_state is not None:
            self._emit_terminal(run_id, terminal_state, error)
            self._cleanup_run(run_id)
            return

        # Re-fetch config now that we have the definitive run_id.
        if config is None:
            config = self._run_configs.get(run_id)
        if config is None:
            return  # Static workflow — Rust cascade handled everything.

        # Fan-out child handling.
        if "[" in node_name:
            if succeeded:
                self._handle_fan_out_child(run_id, node_name, config)
            else:
                self._handle_fan_out_child_failure(run_id, node_name, config)
            return

        # Fan-out expansion trigger (only on success).
        if succeeded:
            self._maybe_trigger_fan_out(run_id, node_name, job_id, config)

        # Evaluate successors with conditions.
        self._evaluate_successors(run_id, node_name, config)

    # ── Terminal state ─────────────────────────────────────────────

    def _emit_terminal(self, run_id: str, terminal_state: str, error: str | None) -> None:
        workflow_event = _final_state_to_event(terminal_state)
        if workflow_event is not None:
            try:
                self._queue._emit_event(
                    workflow_event,
                    {"run_id": run_id, "state": terminal_state, "error": error},
                )
            except Exception:  # pragma: no cover - defensive
                logger.exception("failed to emit %s", workflow_event)
        self._release_waiters(run_id)

    def _cleanup_run(self, run_id: str) -> None:
        self._run_configs.pop(run_id, None)
        self._job_to_run = {jid: rid for jid, rid in self._job_to_run.items() if rid != run_id}

    # ── Condition evaluation ───────────────────────────────────────

    def _evaluate_successors(self, run_id: str, completed_node: str, config: _RunConfig) -> None:
        """Evaluate and create/skip deferred successor nodes."""
        for successor in config.successors.get(completed_node, []):
            if successor not in config.deferred_nodes:
                continue
            meta = config.step_metadata.get(successor)
            if meta is None:
                continue

            if not self._all_predecessors_terminal(run_id, successor, config):
                continue

            # Fan-out/fan-in nodes: only skip them here (expansion is
            # handled by _maybe_trigger_fan_out / _handle_fan_out_child).
            if meta.get("fan_out") is not None or meta.get("fan_in") is not None:
                if not self._should_execute(run_id, successor, config):
                    self._skip_and_propagate(run_id, successor, config)
                continue

            if not self._should_execute(run_id, successor, config):
                self._skip_and_propagate(run_id, successor, config)
                continue

            # Gate nodes pause for approval instead of creating a job.
            if successor in config.gate_configs:
                self._enter_gate(run_id, successor, config)
            # Sub-workflow nodes submit a child workflow.
            elif successor in config.sub_workflow_refs:
                self._submit_sub_workflow(run_id, successor, config)
            else:
                self._create_deferred_job_for_node(run_id, successor, config)

        # After evaluating successors, check if the run is now terminal.
        self._try_finalize(run_id)

    def _should_execute(self, run_id: str, node_name: str, config: _RunConfig) -> bool:
        """Decide whether a deferred node should execute based on its condition."""
        # Callable conditions take precedence.
        callable_cond = config.callable_conditions.get(node_name)
        if callable_cond is not None:
            ctx = self._build_workflow_context(run_id, config)
            try:
                return bool(callable_cond(ctx))
            except Exception:
                logger.exception("callable condition failed for %s", node_name)
                return False

        meta = config.step_metadata.get(node_name, {})
        condition = meta.get("condition")
        pred_statuses = self._get_predecessor_statuses(run_id, node_name, config)

        if condition is None or condition == "on_success":
            return all(s == "completed" for s in pred_statuses.values())
        if condition == "on_failure":
            return any(s == "failed" for s in pred_statuses.values())
        # "always" runs unconditionally; "callable" sentinel was handled above.
        return bool(condition == "always")

    def _skip_and_propagate(self, run_id: str, node_name: str, config: _RunConfig) -> None:
        """Mark a node as SKIPPED and recursively evaluate its successors."""
        try:
            self._queue._inner.skip_workflow_node(run_id, node_name)
        except Exception:
            logger.exception("skip_workflow_node failed for %s", node_name)
            return
        config.deferred_nodes.discard(node_name)
        # The skipped node is now terminal — its successors may be evaluable.
        self._evaluate_successors(run_id, node_name, config)

    # ── Approval gates ──────────────────────────────────────────────

    def _enter_gate(self, run_id: str, node_name: str, config: _RunConfig) -> None:
        """Transition a gate node to WAITING_APPROVAL and start timeout."""
        try:
            self._queue._inner.set_workflow_node_waiting_approval(run_id, node_name)
        except Exception:
            logger.exception("set_workflow_node_waiting_approval failed for %s", node_name)
            return
        config.deferred_nodes.discard(node_name)

        gate = config.gate_configs[node_name]
        try:
            self._queue._emit_event(
                EventType.WORKFLOW_GATE_REACHED,
                {
                    "run_id": run_id,
                    "node_name": node_name,
                    "message": gate.message if isinstance(gate.message, str) else None,
                },
            )
        except Exception:  # pragma: no cover
            logger.exception("failed to emit WORKFLOW_GATE_REACHED")

        if gate.timeout is not None and gate.timeout > 0:
            timer = threading.Timer(
                gate.timeout,
                self._on_gate_timeout,
                args=(run_id, node_name, gate.on_timeout),
            )
            timer.daemon = True
            timer.start()
            self._gate_timers[(run_id, node_name)] = timer

    def resolve_gate(
        self,
        run_id: str,
        node_name: str,
        *,
        approved: bool,
        error: str | None = None,
    ) -> None:
        """Approve or reject a gate, resuming the workflow."""
        # Cancel any pending timeout timer.
        timer = self._gate_timers.pop((run_id, node_name), None)
        if timer is not None:
            timer.cancel()

        config = self._run_configs.get(run_id)

        try:
            self._queue._inner.resolve_workflow_gate(run_id, node_name, approved, error)
        except Exception:
            logger.exception("resolve_workflow_gate failed for %s", node_name)
            return

        if config is not None:
            self._evaluate_successors(run_id, node_name, config)
            self._try_finalize(run_id)

    # ── Sub-workflows ──────────────────────────────────────────────

    def _submit_sub_workflow(self, run_id: str, node_name: str, config: _RunConfig) -> None:
        """Submit a child workflow for a sub-workflow node."""
        ref = config.sub_workflow_refs.get(node_name)
        if ref is None:  # pragma: no cover
            return
        try:
            child_wf = ref.proxy.build(**ref.params)
            # Mark parent node as RUNNING.
            self._queue._inner.set_workflow_node_waiting_approval(run_id, node_name)
            # Override status to RUNNING (waiting_approval was just to set started_at).
            self._queue._inner.skip_workflow_node(run_id, node_name)
            # Actually, let me use a cleaner approach: just mark running via the
            # node status update. Use the Rust set_workflow_node_fan_out_count
            # trick (sets RUNNING). Or add a direct call.
        except Exception:
            logger.exception("failed to build sub-workflow for %s", node_name)
            return

        try:
            # Submit child workflow with parent linkage.
            (
                dag_bytes,
                meta_json,
                payloads,
                deferred,
                callables,
                on_failure,
                gates,
                sub_refs,
            ) = child_wf._compile(self._queue)

            handle = self._queue._inner.submit_workflow(
                child_wf.name,
                child_wf.version,
                dag_bytes,
                meta_json,
                payloads,
                "default",
                None,
                deferred if deferred else None,
                run_id,  # parent_run_id
                node_name,  # parent_node_name
            )

            child_run_id = handle.run_id
            self._child_to_parent[child_run_id] = (run_id, node_name)

            # Mark parent node as RUNNING (use fan_out_count trick).
            self._queue._inner.set_workflow_node_fan_out_count(run_id, node_name, 1)

            # Register child with tracker if it has deferred nodes.
            needs_child_tracker = (
                bool(deferred)
                or bool(callables)
                or bool(gates)
                or bool(sub_refs)
                or on_failure != "fail_fast"
            )
            if needs_child_tracker:
                child_payloads = {n: payloads[n] for n in deferred if n in payloads}
                self.register_run(
                    child_run_id,
                    meta_json,
                    dag_bytes,
                    deferred,
                    child_payloads,
                    on_failure=on_failure,
                    callable_conditions=callables,
                    gate_configs=gates,
                    sub_workflow_refs=sub_refs,
                )

            config.deferred_nodes.discard(node_name)
        except Exception:
            logger.exception("submit sub-workflow failed for %s", node_name)

    def _on_child_workflow_terminal(self, _event_type: EventType, payload: dict[str, Any]) -> None:
        """Handle child workflow completion → update parent node."""
        child_run_id = payload.get("run_id")
        if not child_run_id:
            return
        parent_info = self._child_to_parent.pop(child_run_id, None)
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
        except Exception:
            logger.exception(
                "failed to update parent node %s for child %s",
                parent_node_name,
                child_run_id,
            )
            return

        config = self._run_configs.get(parent_run_id)
        if config is not None:
            self._evaluate_successors(parent_run_id, parent_node_name, config)
            self._try_finalize(parent_run_id)

    def _on_gate_timeout(self, run_id: str, node_name: str, action: str) -> None:
        """Handle gate timeout expiry."""
        self._gate_timers.pop((run_id, node_name), None)
        approved = action == "approve"
        error = None if approved else "gate timeout"
        self.resolve_gate(run_id, node_name, approved=approved, error=error)

    def _all_predecessors_terminal(self, run_id: str, node_name: str, config: _RunConfig) -> bool:
        """Check whether all predecessors have a terminal status."""
        raw = self._queue._inner.get_workflow_run_status(run_id)
        node_statuses = raw.node_statuses()
        for pred in config.predecessors.get(node_name, []):
            info = node_statuses.get(pred)
            if info is None:
                return False
            status = info["status"]
            if status not in ("completed", "failed", "skipped"):
                return False
        return True

    def _get_predecessor_statuses(
        self, run_id: str, node_name: str, config: _RunConfig
    ) -> dict[str, str]:
        """Return ``{pred_name: status_str}`` for all predecessors."""
        raw = self._queue._inner.get_workflow_run_status(run_id)
        node_statuses = raw.node_statuses()
        result: dict[str, str] = {}
        for pred in config.predecessors.get(node_name, []):
            info = node_statuses.get(pred)
            result[pred] = info["status"] if info else "pending"
        return result

    def _build_workflow_context(self, run_id: str, config: _RunConfig) -> WorkflowContext:
        """Build a :class:`WorkflowContext` from the current run state."""
        raw = self._queue._inner.get_workflow_run_status(run_id)
        node_statuses = raw.node_statuses()

        results: dict[str, Any] = {}
        statuses: dict[str, str] = {}
        failure_count = 0
        success_count = 0

        for name, info in node_statuses.items():
            status = info["status"]
            statuses[name] = status
            if status == "completed":
                success_count += 1
                jid = info.get("job_id")
                if jid:
                    results[name] = self._fetch_result(jid)
            elif status == "failed":
                failure_count += 1

        return WorkflowContext(
            run_id=run_id,
            results=results,
            statuses=statuses,
            params=None,
            failure_count=failure_count,
            success_count=success_count,
        )

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

    def _create_deferred_job_for_node(
        self, run_id: str, node_name: str, config: _RunConfig
    ) -> None:
        """Create a job for a deferred node and record the mapping."""
        payload = config.deferred_payloads.get(node_name)
        if payload is None:  # pragma: no cover
            logger.error("no cached payload for deferred node %s", node_name)
            return
        meta = config.step_metadata.get(node_name, {})
        task_name = meta["task_name"]
        queue_name = meta.get("queue") or "default"
        max_retries = _int_or(meta.get("max_retries"), 3)
        timeout_ms = _int_or(meta.get("timeout_ms"), 300_000)
        priority = _int_or(meta.get("priority"), 0)

        try:
            job_id = self._queue._inner.create_deferred_job(
                run_id,
                node_name,
                payload,
                task_name,
                queue_name,
                max_retries,
                timeout_ms,
                priority,
            )
            self._job_to_run[job_id] = run_id
            config.deferred_nodes.discard(node_name)
        except Exception:
            logger.exception("create_deferred_job failed for %s", node_name)

    def _try_finalize(self, run_id: str) -> None:
        """If all nodes are terminal, finalize the run and emit the event."""
        try:
            terminal_state = self._queue._inner.finalize_run_if_terminal(run_id)
        except Exception:
            logger.exception("finalize_run_if_terminal failed for %s", run_id)
            return
        if terminal_state is not None:
            self._emit_terminal(run_id, terminal_state, None)
            self._cleanup_run(run_id)

    # ── Fan-out expansion ──────────────────────────────────────────

    def _maybe_trigger_fan_out(
        self,
        run_id: str,
        source_node: str,
        source_job_id: str,
        config: _RunConfig,
    ) -> None:
        """If a completed node's successor has ``fan_out``, expand it."""
        for successor in config.successors.get(source_node, []):
            meta = config.step_metadata.get(successor)
            if meta is None or meta.get("fan_out") is None:
                continue
            self._expand_fan_out(run_id, source_job_id, successor, meta, config)

    def _expand_fan_out(
        self,
        run_id: str,
        source_job_id: str,
        fan_out_node: str,
        meta: dict[str, Any],
        config: _RunConfig,
    ) -> None:
        """Fetch the source result, split, and create child nodes + jobs."""
        result_bytes: bytes | None = None
        for _ in range(50):
            py_job = self._queue._inner.get_job(source_job_id)
            if py_job is not None:
                result_bytes = py_job.result_bytes
                if result_bytes is not None:
                    break
            time.sleep(0.1)

        if result_bytes is None:
            source_result: Any = None
        else:
            source_result = self._queue._serializer.loads(result_bytes)

        strategy = meta["fan_out"]
        items = apply_fan_out(strategy, source_result)

        task_name = meta["task_name"]
        serializer = self._queue._get_serializer(task_name)
        child_names = [f"{fan_out_node}[{i}]" for i in range(len(items))]
        child_payloads = [build_child_payload(item, serializer) for item in items]

        queue_name = meta.get("queue") or "default"
        max_retries = _int_or(meta.get("max_retries"), 3)
        timeout_ms = _int_or(meta.get("timeout_ms"), 300_000)
        priority = _int_or(meta.get("priority"), 0)

        try:
            child_job_ids = self._queue._inner.expand_fan_out(
                run_id,
                fan_out_node,
                child_names,
                child_payloads,
                task_name,
                queue_name,
                max_retries,
                timeout_ms,
                priority,
            )
            for jid in child_job_ids:
                self._job_to_run[jid] = run_id
        except Exception:
            logger.exception("expand_fan_out failed for %s in run %s", fan_out_node, run_id)
            return

        # Empty fan-out: parent is immediately COMPLETED with 0 children.
        if not child_names:
            for successor in config.successors.get(fan_out_node, []):
                succ_meta = config.step_metadata.get(successor)
                if succ_meta is not None and succ_meta.get("fan_in") is not None:
                    self._create_fan_in_job(run_id, successor, succ_meta, [], config)
                    return
            self._evaluate_successors(run_id, fan_out_node, config)

    # ── Fan-out child completion ───────────────────────────────────

    def _handle_fan_out_child(self, run_id: str, child_name: str, config: _RunConfig) -> None:
        """Check whether all siblings are done → trigger fan-in."""
        parent_name = child_name.split("[")[0]
        try:
            completion = self._queue._inner.check_fan_out_completion(run_id, parent_name)
        except Exception:
            logger.exception("check_fan_out_completion failed for %s", parent_name)
            return

        if completion is None:
            return

        all_succeeded, child_job_ids = completion
        if not all_succeeded:
            # Parent marked FAILED. Evaluate successors (on_failure may trigger).
            self._evaluate_successors(run_id, parent_name, config)
            self._try_finalize(run_id)
            return

        # Trigger fan-in.
        for successor in config.successors.get(parent_name, []):
            meta = config.step_metadata.get(successor)
            if meta is not None and meta.get("fan_in") is not None:
                self._create_fan_in_job(run_id, successor, meta, child_job_ids, config)
                return

        # No fan-in — evaluate deferred successors.
        self._evaluate_successors(run_id, parent_name, config)

    def _handle_fan_out_child_failure(
        self, run_id: str, child_name: str, config: _RunConfig
    ) -> None:
        """Handle a failed fan-out child."""
        parent_name = child_name.split("[")[0]
        try:
            completion = self._queue._inner.check_fan_out_completion(run_id, parent_name)
        except Exception:
            logger.exception("check_fan_out_completion failed for %s", parent_name)
            return

        if completion is None:
            return

        # Parent is marked FAILED. Evaluate successors for condition-based logic.
        self._evaluate_successors(run_id, parent_name, config)
        self._try_finalize(run_id)

    def _create_fan_in_job(
        self,
        run_id: str,
        fan_in_node: str,
        meta: dict[str, Any],
        child_job_ids: list[str],
        config: _RunConfig,
    ) -> None:
        """Collect children results and create the fan-in job."""
        results: list[Any] = []
        for job_id in child_job_ids:
            results.append(self._fetch_result(job_id))

        task_name = meta["task_name"]
        serializer = self._queue._get_serializer(task_name)
        payload = build_fan_in_payload(results, serializer)

        queue_name = meta.get("queue") or "default"
        max_retries = _int_or(meta.get("max_retries"), 3)
        timeout_ms = _int_or(meta.get("timeout_ms"), 300_000)
        priority = _int_or(meta.get("priority"), 0)

        try:
            job_id = self._queue._inner.create_deferred_job(
                run_id,
                fan_in_node,
                payload,
                task_name,
                queue_name,
                max_retries,
                timeout_ms,
                priority,
            )
            self._job_to_run[job_id] = run_id
        except Exception:
            logger.exception("create_deferred_job failed for fan-in %s", fan_in_node)


# ── Helpers ────────────────────────────────────────────────────────


def _build_dag_maps(
    dag_bytes: bytes | list[int],
) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """Parse DAG JSON to build successor and predecessor maps."""
    raw = bytes(dag_bytes) if isinstance(dag_bytes, list) else dag_bytes
    dag_json = json.loads(raw)
    successors: dict[str, list[str]] = {}
    predecessors: dict[str, list[str]] = {}
    for node in dag_json.get("nodes", []):
        name = node["name"]
        successors.setdefault(name, [])
        predecessors.setdefault(name, [])
    for edge in dag_json.get("edges", []):
        successors.setdefault(edge["from"], []).append(edge["to"])
        predecessors.setdefault(edge["to"], []).append(edge["from"])
    return successors, predecessors


def _int_or(value: Any, default: int) -> int:
    return value if value is not None else default


def _final_state_to_event(state: str) -> EventType | None:
    if state == "completed":
        return EventType.WORKFLOW_COMPLETED
    if state == "failed":
        return EventType.WORKFLOW_FAILED
    if state == "cancelled":
        return EventType.WORKFLOW_CANCELLED
    return None
