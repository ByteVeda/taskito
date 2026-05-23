"""Reverse-order saga orchestrator.

When a workflow run with ``on_failure="fail_fast"`` and a non-empty
:attr:`_RunConfig.compensation_map` enters terminal failure, the tracker
hands control to this module. The orchestrator:

1. Transitions the run state to ``Compensating`` and emits
   ``WORKFLOW_COMPENSATING``.
2. Collects nodes that completed successfully and have a registered
   compensator. ``Pending``/``Ready``/``Failed``/``Skipped`` nodes are
   excluded — only ``Completed`` / ``CacheHit`` are compensable.
3. Groups the compensable nodes into reverse topological levels
   (leaves first, roots last) and dispatches each level as a parallel
   wave.
4. On each compensation completion, marks the node ``Compensated`` /
   ``CompensationFailed`` and advances when the wave is fully drained.
5. Finalizes the run to ``Compensated`` (every wave succeeded) or
   ``CompensationFailed`` (one or more compensations failed —
   subsequent waves are NOT dispatched, since compensation is
   best-effort and downstream undo may depend on upstream undo).

Idempotency: each compensation job is enqueued with
``idempotency_key=f"compensation:{run_id}:{node_name}"``. The first call
creates the job; a duplicate (e.g. after a tracker restart) hits the
existing partial-index dedup in all 3 storage backends and is a no-op.

v1 contract for the compensator's args: the framework calls
``compensator(forward_args, forward_kwargs, forward_result)``. In v1
``forward_args`` and ``forward_kwargs`` come from the deferred-payload
cache when the forward node was deferred; otherwise they're empty
tuples/dicts. ``forward_result`` is always ``None`` in v1 — wiring
through the actual return value requires an extra round-trip to fetch
the job result and is reserved for a follow-up enhancement.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import TYPE_CHECKING, Any

from taskito.events import EventType
from taskito.workflows.analysis import topological_levels

if TYPE_CHECKING:
    from taskito.app import Queue
    from taskito.workflows.builder import _Step
    from taskito.workflows.tracker.types import _RunConfig

logger = logging.getLogger("taskito.workflows.saga")


class SagaOrchestrator:
    """Per-Queue saga state machine."""

    def __init__(self, queue: Queue) -> None:
        self._queue = queue
        self._lock = threading.RLock()
        self._run_waves: dict[str, list[list[str]]] = {}
        self._run_inflight: dict[str, set[str]] = {}
        self._run_any_failed: dict[str, bool] = {}
        # Reverse map: compensation job id → (run_id, node_name) so the
        # tracker can route completion events back into the orchestrator.
        self._comp_job_to_node: dict[str, tuple[str, str]] = {}

    # ── Public API used by tracker ──────────────────────────────────────

    def is_compensation_job(self, job_id: str) -> bool:
        """Whether ``job_id`` is one we dispatched for compensation."""
        with self._lock:
            return job_id in self._comp_job_to_node

    def start_compensation(
        self,
        run_id: str,
        run_config: _RunConfig,
        steps: dict[str, _Step],
    ) -> bool:
        """Begin reverse-order compensation for ``run_id``.

        Returns ``True`` if compensation was started, ``False`` if the
        run is not eligible (no compensable completed nodes, or already
        compensating).
        """
        with self._lock:
            if run_id in self._run_waves:
                return False
            if not run_config.compensation_map:
                return False

            completed = self._fetch_compensable_nodes(run_id, run_config.compensation_map)
            if not completed:
                return False

            waves = _reverse_topo_waves(steps, restrict_to=completed)
            if not waves:
                return False

            self._run_waves[run_id] = waves
            self._run_inflight[run_id] = set()
            self._run_any_failed[run_id] = False

            self._mark_run_compensating(run_id)

            self._queue._emit_event(
                EventType.WORKFLOW_COMPENSATING,
                {"workflow_run_id": run_id},
            )

        self._dispatch_next_wave(run_id, run_config)
        return True

    def on_compensation_completed(
        self,
        job_id: str,
        succeeded: bool,
        error: str | None,
    ) -> None:
        """Tracker callback for a completed compensation job.

        Updates per-node bookkeeping. When the in-flight set for the run
        empties, advances to the next wave or finalizes the run.
        """
        run_id: str | None = None
        node_name: str | None = None
        wave_complete = False
        with self._lock:
            mapping = self._comp_job_to_node.pop(job_id, None)
            if mapping is None:
                return
            run_id, node_name = mapping

            inflight = self._run_inflight.get(run_id)
            if inflight is None:
                return
            inflight.discard(node_name)
            if not succeeded:
                self._run_any_failed[run_id] = True

            self._record_node_outcome(run_id, node_name, succeeded, error)
            wave_complete = not inflight

        run_config = self._lookup_run_config(run_id)
        if wave_complete:
            self._advance_or_finalize(run_id, run_config)

    # ── Internal ────────────────────────────────────────────────────────

    def _lookup_run_config(self, run_id: str) -> _RunConfig | None:
        tracker = getattr(self._queue, "_workflow_tracker", None)
        if tracker is None:
            return None
        configs: dict[str, _RunConfig] = getattr(tracker, "_run_configs", {})
        return configs.get(run_id)

    def _fetch_compensable_nodes(
        self,
        run_id: str,
        compensation_map: dict[str, str],
    ) -> set[str]:
        """Return the subset of ``compensation_map`` that should run.

        A node is compensable when its current storage status is
        ``"completed"`` or ``"cache_hit"`` AND it has a registered
        compensator.
        """
        try:
            node_data = self._queue._inner.get_base_run_node_data(run_id)
        except Exception:
            logger.exception("saga: failed to fetch node data for run %s", run_id)
            return set()

        compensable: set[str] = set()
        # node_data is list[(name, status_str, result_hash)] per the Rust
        # binding's `get_base_run_node_data` shape.
        for entry in node_data:
            try:
                name = entry[0]
                status = entry[1]
            except (IndexError, TypeError):
                continue
            if status in ("completed", "cache_hit") and name in compensation_map:
                compensable.add(name)
        return compensable

    def _advance_or_finalize(self, run_id: str, run_config: _RunConfig | None) -> None:
        with self._lock:
            waves = self._run_waves.get(run_id)
            any_failed = self._run_any_failed.get(run_id, False)

            if any_failed:
                # First failure → terminate compensation, do not dispatch more.
                if waves:
                    self._run_waves[run_id] = []
                self._finalize_locked(run_id, succeeded=False)
                return

            if not waves:
                self._finalize_locked(run_id, succeeded=True)
                return

        if run_config is not None:
            self._dispatch_next_wave(run_id, run_config)

    def _dispatch_next_wave(self, run_id: str, run_config: _RunConfig) -> None:
        with self._lock:
            waves = self._run_waves.get(run_id)
            if not waves:
                return
            wave = waves.pop(0)
            self._run_inflight[run_id] = set(wave)

        for node_name in wave:
            self._dispatch_single(run_id, node_name, run_config)

    def _dispatch_single(
        self,
        run_id: str,
        node_name: str,
        run_config: _RunConfig,
    ) -> None:
        comp_task_name = run_config.compensation_map.get(node_name)
        if comp_task_name is None:
            logger.warning(
                "saga: no compensator registered for %s/%s — skipping",
                run_id,
                node_name,
            )
            self._handle_inline_no_op(run_id, node_name, succeeded=True, error=None)
            return

        forward_args, forward_kwargs = self._load_forward_payload(node_name, run_config)

        idempotency_key = f"compensation:{run_id}:{node_name}"
        metadata_blob = json.dumps(
            {
                "workflow_run_id": run_id,
                "workflow_node_name": node_name,
                "_kind": "compensation",
            }
        )

        # SQLite serializes writes; the result handler that just failed
        # the forward job may still be flushing its own writes when we
        # land here from the event bus. Retry briefly so a transient
        # ``database is locked`` doesn't bubble out as a saga failure.
        job = None
        last_exc: Exception | None = None
        for attempt in range(5):
            try:
                job = self._queue.enqueue(
                    comp_task_name,
                    args=(forward_args, forward_kwargs, None),
                    kwargs=None,
                    idempotency_key=idempotency_key,
                    metadata=metadata_blob,
                )
                last_exc = None
                break
            except Exception as exc:
                last_exc = exc
                if "database is locked" not in str(exc):
                    break
                time.sleep(0.05 * (attempt + 1))
        if last_exc is not None or job is None:
            logger.exception(
                "saga: enqueue of compensation %s for %s/%s failed",
                comp_task_name,
                run_id,
                node_name,
            )
            self._handle_inline_no_op(
                run_id,
                node_name,
                succeeded=False,
                error=f"failed to enqueue compensator: {last_exc}",
            )
            return

        job_id = getattr(job, "id", None)
        if job_id is None:
            # Batched or no real job id — treat as immediate success.
            self._handle_inline_no_op(run_id, node_name, succeeded=True, error=None)
            return

        now_ms = int(time.time() * 1000)
        self._safe_call(
            "set_workflow_node_compensation_job",
            run_id,
            node_name,
            job_id,
            now_ms,
        )

        with self._lock:
            self._comp_job_to_node[job_id] = (run_id, node_name)

        self._queue._emit_event(
            EventType.NODE_COMPENSATING,
            {
                "workflow_run_id": run_id,
                "workflow_node_name": node_name,
                "compensation_job_id": job_id,
                "compensation_task": comp_task_name,
            },
        )

    def _handle_inline_no_op(
        self,
        run_id: str,
        node_name: str,
        *,
        succeeded: bool,
        error: str | None,
    ) -> None:
        """Treat a node as immediately completed without a real comp job.

        Used when no compensator is registered, or the enqueue failed
        synchronously. Updates state and lets the wave advance.
        """
        wave_complete = False
        with self._lock:
            inflight = self._run_inflight.get(run_id)
            if inflight is None:
                return
            inflight.discard(node_name)
            if not succeeded:
                self._run_any_failed[run_id] = True

            self._record_node_outcome(run_id, node_name, succeeded, error)
            wave_complete = not inflight

        run_config = self._lookup_run_config(run_id)
        if wave_complete:
            self._advance_or_finalize(run_id, run_config)

    def _record_node_outcome(
        self,
        run_id: str,
        node_name: str,
        succeeded: bool,
        error: str | None,
    ) -> None:
        now_ms = int(time.time() * 1000)
        if succeeded:
            self._safe_call("set_workflow_node_compensated", run_id, node_name, now_ms)
            event_type = EventType.NODE_COMPENSATED
        else:
            self._safe_call(
                "set_workflow_node_compensation_failed",
                run_id,
                node_name,
                error or "compensation failed",
                now_ms,
            )
            event_type = EventType.NODE_COMPENSATION_FAILED

        self._queue._emit_event(
            event_type,
            {
                "workflow_run_id": run_id,
                "workflow_node_name": node_name,
                "error": error,
            },
        )

    def _mark_run_compensating(self, run_id: str) -> None:
        """Move the run from ``Running`` to ``Compensating`` in storage."""
        try:
            self._queue._inner.set_workflow_run_compensating(run_id)
        except Exception:
            logger.exception("saga: failed to mark run %s compensating", run_id)

    def _finalize_locked(self, run_id: str, *, succeeded: bool) -> None:
        """Cleanly finalize a saga. Must be called with ``self._lock``."""
        self._run_waves.pop(run_id, None)
        self._run_inflight.pop(run_id, None)
        any_failed = self._run_any_failed.pop(run_id, False)
        self._comp_job_to_node = {
            jid: (rid, nn) for jid, (rid, nn) in self._comp_job_to_node.items() if rid != run_id
        }

        now_ms = int(time.time() * 1000)
        try:
            if succeeded:
                self._queue._inner.set_workflow_run_compensated(run_id, now_ms)
            else:
                self._queue._inner.set_workflow_run_compensation_failed(
                    run_id, now_ms, "one or more compensations failed"
                )
        except Exception:
            logger.exception(
                "saga: failed to finalize run %s as %s",
                run_id,
                "compensated" if succeeded else "compensation_failed",
            )

        event_type = (
            EventType.WORKFLOW_COMPENSATED if succeeded else EventType.WORKFLOW_COMPENSATION_FAILED
        )
        self._queue._emit_event(
            event_type,
            {"workflow_run_id": run_id, "any_failed": any_failed},
        )

    def _safe_call(self, method_name: str, *args: Any) -> None:
        """Invoke a storage method on the Rust binding, logging on failure."""
        try:
            method = getattr(self._queue._inner, method_name)
        except AttributeError:
            logger.warning("saga: binding %s is not available", method_name)
            return
        try:
            method(*args)
        except Exception:
            logger.exception("saga: %s(%s) failed", method_name, args)

    def _load_forward_payload(
        self,
        node_name: str,
        run_config: _RunConfig,
    ) -> tuple[tuple, dict[str, Any]]:
        """Reconstruct the forward task's args and kwargs (v1 best-effort).

        For deferred nodes the payload lives in
        ``run_config.deferred_payloads`` (it's what we serialized at
        submit time). For static nodes there is currently no stored copy
        of the args at compensation time — they're embedded in the
        already-completed job's payload and not surfaced through the
        existing API. v1 returns empty tuples/dicts in that case;
        compensators that need the original args can either move the
        forward step into deferred status or look it up themselves.
        """
        raw_payload = run_config.deferred_payloads.get(node_name)
        if raw_payload is None:
            return (), {}
        try:
            step_meta = run_config.step_metadata.get(node_name, {})
            task_name = step_meta.get("task_name")
            if task_name is None:
                return (), {}
            args, kwargs = self._queue._deserialize_payload(task_name, raw_payload)
            return tuple(args), dict(kwargs)
        except Exception:
            logger.exception(
                "saga: deserialize forward payload for %s — compensator will receive empty args",
                node_name,
            )
            return (), {}


def _reverse_topo_waves(steps: dict[str, _Step], restrict_to: set[str]) -> list[list[str]]:
    """Compute reverse-topological waves of the steps in ``restrict_to``.

    Each forward-topological level becomes one compensation wave,
    iterated in reverse. Nodes not in ``restrict_to`` are dropped.
    Empty waves are omitted.
    """
    forward_levels = topological_levels(steps)
    waves: list[list[str]] = []
    for level in reversed(forward_levels):
        wave = [n for n in level if n in restrict_to]
        if wave:
            waves.append(wave)
    return waves


__all__ = ["SagaOrchestrator"]
