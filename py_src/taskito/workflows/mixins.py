"""Mixin that adds workflow operations to :class:`taskito.app.Queue`."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .builder import Workflow, WorkflowProxy
from .run import WorkflowRun

if TYPE_CHECKING:
    from collections.abc import Callable


class QueueWorkflowMixin:
    """Adds workflow APIs to Queue.

    Mixed into ``Queue`` unconditionally — the underlying native methods are
    only present when the ``workflows`` feature is compiled in, so calling
    these methods without the feature will raise ``AttributeError``.
    """

    _inner: Any
    _workflow_registry: dict[str, WorkflowProxy]

    def submit_workflow(
        self,
        workflow: Workflow,
        *,
        incremental: bool = False,
        base_run: str | None = None,
    ) -> WorkflowRun:
        """Submit a built :class:`Workflow` for execution.

        Args:
            workflow: The workflow to submit.
            incremental: If ``True``, skip nodes that completed in *base_run*.
            base_run: Run ID of a prior run to use for cache comparison.

        Static step jobs are created up front with ``depends_on`` chains.
        Deferred nodes (fan-out, fan-in, conditions, ``on_failure="continue"``)
        get ``WorkflowNode`` entries only — their jobs are created at runtime
        by the :class:`~taskito.workflows.tracker.WorkflowTracker`.
        """
        (
            dag_bytes,
            step_metadata_json,
            node_payloads,
            deferred_nodes,
            callable_conditions,
            on_failure,
            gate_configs,
            sub_workflow_refs,
        ) = workflow._compile(self)  # type: ignore[arg-type]

        # Compute cache hits for incremental runs.
        cache_hit_nodes: dict[str, str] | None = None
        if incremental and base_run:
            from .incremental import compute_dirty_set
            from .tracker import _build_dag_maps

            base_nodes = self._inner.get_base_run_node_data(base_run)
            _, preds = _build_dag_maps(dag_bytes)
            succs, _ = _build_dag_maps(dag_bytes)

            # Get base run completion time for TTL check.
            base_status = self._inner.get_workflow_run_status(base_run)
            base_completed = base_status.completed_at

            _, cached = compute_dirty_set(
                base_nodes=base_nodes,
                new_node_names=list(node_payloads.keys()),
                successors=succs,
                predecessors=preds,
                cache_ttl=workflow.cache_ttl,
                base_run_completed_at=base_completed,
            )
            if cached:
                cache_hit_nodes = cached

        handle = self._inner.submit_workflow(
            workflow.name,
            workflow.version,
            dag_bytes,
            step_metadata_json,
            node_payloads,
            "default",
            None,
            deferred_nodes if deferred_nodes else None,
            None,  # parent_run_id
            None,  # parent_node_name
            cache_hit_nodes,
        )

        # Register with the tracker when the workflow needs Python-side
        # orchestration (deferred nodes, conditions, gates, or continue mode).
        tracker = getattr(self, "_workflow_tracker", None)
        needs_tracker = (
            bool(deferred_nodes)
            or bool(callable_conditions)
            or bool(gate_configs)
            or bool(sub_workflow_refs)
            or on_failure != "fail_fast"
        )
        if tracker is not None and needs_tracker:
            deferred_payloads = {
                name: node_payloads[name] for name in deferred_nodes if name in node_payloads
            }
            tracker.register_run(
                handle.run_id,
                step_metadata_json,
                dag_bytes,
                deferred_nodes,
                deferred_payloads,
                on_failure=on_failure,
                callable_conditions=callable_conditions,
                gate_configs=gate_configs,
                sub_workflow_refs=sub_workflow_refs,
            )

        return WorkflowRun(self, handle.run_id, handle.name)  # type: ignore[arg-type]

    def approve_gate(self, run_id: str, node_name: str) -> None:
        """Approve an approval gate, allowing the workflow to continue."""
        tracker = getattr(self, "_workflow_tracker", None)
        if tracker is None:
            raise RuntimeError("workflow tracker not available")
        tracker.resolve_gate(run_id, node_name, approved=True)

    def reject_gate(self, run_id: str, node_name: str, error: str = "rejected") -> None:
        """Reject an approval gate, failing the gate node."""
        tracker = getattr(self, "_workflow_tracker", None)
        if tracker is None:
            raise RuntimeError("workflow tracker not available")
        tracker.resolve_gate(run_id, node_name, approved=False, error=error)

    def workflow(
        self,
        name: str | None = None,
        *,
        version: int = 1,
    ) -> Callable[[Callable[..., Workflow]], WorkflowProxy]:
        """Decorator that registers a workflow factory.

        Example::

            @queue.workflow("nightly_etl")
            def etl() -> Workflow:
                wf = Workflow()
                wf.step("extract", extract_task)
                wf.step("load", load_task, after="extract")
                return wf

            run = etl.submit()
            run.wait()
        """

        def decorator(factory: Callable[..., Workflow]) -> WorkflowProxy:
            wf_name = name or factory.__name__
            proxy = WorkflowProxy(self, wf_name, version, factory)  # type: ignore[arg-type]
            self._workflow_registry[wf_name] = proxy
            return proxy

        return decorator
