"""Pure-Python workflow DAG builder.

Steps are collected in insertion order and validated at ``build()`` time by
delegating to the Rust ``PyWorkflowBuilder`` (which owns a dagron-core DAG
instance and enforces acyclicity + unique node names).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Callable

    from taskito.app import Queue
    from taskito.task import TaskWrapper

    from .run import WorkflowRun


_VALID_FAN_OUT = frozenset({"each"})
_VALID_FAN_IN = frozenset({"all"})
_VALID_CONDITIONS = frozenset({"on_success", "on_failure", "always"})
_VALID_ON_FAILURE = frozenset({"fail_fast", "continue"})


@dataclass
class GateConfig:
    """Configuration for an approval gate step."""

    timeout: float | None = None
    """Seconds until auto-resolve. ``None`` waits indefinitely."""

    on_timeout: str = "reject"
    """Action on timeout: ``"approve"`` or ``"reject"``."""

    message: str | Callable | None = None
    """Human-readable message shown to approvers."""


@dataclass
class _Step:
    """Internal representation of a single workflow step."""

    name: str
    task_name: str
    after: list[str] = field(default_factory=list)
    args: tuple = ()
    kwargs: dict[str, Any] = field(default_factory=dict)
    queue: str | None = None
    max_retries: int | None = None
    timeout_ms: int | None = None
    priority: int | None = None
    fan_out: str | None = None
    fan_in: str | None = None
    condition: str | Callable | None = None
    gate_config: GateConfig | None = None
    sub_workflow: SubWorkflowRef | None = None


class Workflow:
    """Builder for a workflow DAG.

    Steps are added via :meth:`step` and the workflow is materialized at
    submission time. Each step is a registered taskito task.

    Example::

        wf = Workflow(name="my_pipeline")
        wf.step("a", task_a)
        wf.step("b", task_b, after="a")
        wf.step("c", task_c, after="b")
        run = queue.submit_workflow(wf)
        run.wait()
    """

    def __init__(
        self,
        name: str = "workflow",
        version: int = 1,
        on_failure: str = "fail_fast",
        cache_ttl: float | None = None,
    ):
        if on_failure not in _VALID_ON_FAILURE:
            raise ValueError(
                f"on_failure must be one of {sorted(_VALID_ON_FAILURE)}, got '{on_failure}'"
            )
        self.name = name
        self.version = version
        self.on_failure = on_failure
        self.cache_ttl = cache_ttl
        self._steps: dict[str, _Step] = {}

    def step(
        self,
        name: str,
        task: TaskWrapper,
        *,
        after: str | list[str] | None = None,
        args: tuple = (),
        kwargs: dict[str, Any] | None = None,
        queue: str | None = None,
        max_retries: int | None = None,
        timeout_ms: int | None = None,
        priority: int | None = None,
        fan_out: str | None = None,
        fan_in: str | None = None,
        condition: str | Callable | None = None,
    ) -> Workflow:
        """Add a step to the workflow.

        Args:
            name: Unique name for this step within the workflow.
            task: The registered taskito task (a ``TaskWrapper``).
            after: Name(s) of predecessor steps. All must already be added.
            args: Positional arguments passed to the task.
            kwargs: Keyword arguments passed to the task.
            queue: Override the queue for this step.
            max_retries: Override the max retry count for this step.
            timeout_ms: Override the timeout (in milliseconds) for this step.
            priority: Override the priority for this step.
            fan_out: Fan-out strategy. ``"each"`` splits the predecessor's
                return value into one job per element.
            fan_in: Fan-in strategy. ``"all"`` collects all fan-out children's
                results into a list passed to this step.

        Returns:
            ``self`` for chaining.

        Raises:
            ValueError: If the name is already in use, ``after`` references
                a step not yet added, or fan-out/fan-in configuration is invalid.
        """
        if name in self._steps:
            raise ValueError(f"step '{name}' already defined")
        if "[" in name:
            raise ValueError(
                f"step '{name}': step names must not contain '[' (reserved for fan-out children)"
            )

        task_name = getattr(task, "_task_name", None) or getattr(task, "name", None)
        if not task_name:
            raise ValueError(f"step '{name}': task must be a registered @queue.task() function")

        if after is None:
            predecessors: list[str] = []
        elif isinstance(after, str):
            predecessors = [after]
        else:
            predecessors = list(after)

        for pred in predecessors:
            if pred not in self._steps:
                raise ValueError(
                    f"step '{name}': predecessor '{pred}' must be added before this step"
                )

        if fan_out is not None:
            if fan_out not in _VALID_FAN_OUT:
                valid = sorted(_VALID_FAN_OUT)
                raise ValueError(f"step '{name}': fan_out must be one of {valid}, got '{fan_out}'")
            if len(predecessors) != 1:
                raise ValueError(f"step '{name}': fan_out step must have exactly one predecessor")

        if fan_in is not None:
            if fan_in not in _VALID_FAN_IN:
                raise ValueError(
                    f"step '{name}': fan_in must be one of {sorted(_VALID_FAN_IN)}, got '{fan_in}'"
                )
            if len(predecessors) != 1:
                raise ValueError(f"step '{name}': fan_in step must have exactly one predecessor")
            pred_step = self._steps[predecessors[0]]
            if pred_step.fan_out is None:
                raise ValueError(
                    f"step '{name}': fan_in predecessor '{predecessors[0]}' must have fan_out set"
                )

        is_invalid_condition = (
            condition is not None
            and not callable(condition)
            and condition not in _VALID_CONDITIONS
        )
        if is_invalid_condition:
            raise ValueError(
                f"step '{name}': condition must be one of "
                f"{sorted(_VALID_CONDITIONS)} or a callable, got '{condition}'"
            )

        sub_wf = task if isinstance(task, SubWorkflowRef) else None

        self._steps[name] = _Step(
            name=name,
            task_name=task_name,
            after=predecessors,
            args=args,
            kwargs=kwargs or {},
            queue=queue,
            max_retries=max_retries,
            timeout_ms=timeout_ms,
            priority=priority,
            fan_out=fan_out,
            fan_in=fan_in,
            condition=condition,
            sub_workflow=sub_wf,
        )
        return self

    def gate(
        self,
        name: str,
        *,
        after: str | list[str] | None = None,
        condition: str | Callable | None = None,
        timeout: float | None = None,
        on_timeout: str = "reject",
        message: str | Callable | None = None,
    ) -> Workflow:
        """Add an approval gate step.

        The workflow pauses at this node until
        :meth:`~taskito.workflows.mixins.QueueWorkflowMixin.approve_gate`
        or
        :meth:`~taskito.workflows.mixins.QueueWorkflowMixin.reject_gate`
        is called.

        Args:
            name: Unique name for this gate.
            after: Predecessor step name(s).
            condition: Optional condition for entering the gate.
            timeout: Seconds until auto-resolve (``None`` = wait forever).
            on_timeout: ``"approve"`` or ``"reject"`` when timeout fires.
            message: Human-readable message for approvers.
        """
        if name in self._steps:
            raise ValueError(f"step '{name}' already defined")
        if "[" in name:
            raise ValueError(f"step '{name}': names must not contain '['")
        if on_timeout not in ("approve", "reject"):
            raise ValueError(f"gate '{name}': on_timeout must be 'approve' or 'reject'")

        if after is None:
            predecessors: list[str] = []
        elif isinstance(after, str):
            predecessors = [after]
        else:
            predecessors = list(after)
        for pred in predecessors:
            if pred not in self._steps:
                raise ValueError(f"gate '{name}': predecessor '{pred}' must be added first")

        self._steps[name] = _Step(
            name=name,
            task_name="__gate__",
            after=predecessors,
            condition=condition,
            gate_config=GateConfig(
                timeout=timeout,
                on_timeout=on_timeout,
                message=message,
            ),
        )
        return self

    @property
    def step_names(self) -> list[str]:
        return list(self._steps.keys())

    # ── Pre-execution analysis ─────────────────────────────────────

    def ancestors(self, node: str) -> list[str]:
        """Return all transitive predecessors of *node*."""
        from .analysis import ancestors

        return ancestors(self._steps, node)

    def descendants(self, node: str) -> list[str]:
        """Return all transitive successors of *node*."""
        from .analysis import descendants

        return descendants(self._steps, node)

    def topological_levels(self) -> list[list[str]]:
        """Group nodes by topological depth."""
        from .analysis import topological_levels

        return topological_levels(self._steps)

    def stats(self) -> dict[str, int | float]:
        """Compute basic DAG statistics (nodes, edges, depth, width, density)."""
        from .analysis import stats

        return stats(self._steps)

    def critical_path(self, costs: dict[str, float]) -> tuple[list[str], float]:
        """Find the longest-weighted path through the DAG.

        Args:
            costs: Mapping of step name to estimated duration.

        Returns:
            ``(path, total_cost)``
        """
        from .analysis import critical_path

        return critical_path(self._steps, costs)

    def execution_plan(self, max_workers: int = 1) -> list[list[str]]:
        """Generate a step-by-step execution plan respecting worker limits."""
        from .analysis import execution_plan

        return execution_plan(self._steps, max_workers)

    def bottleneck_analysis(self, costs: dict[str, float]) -> dict[str, Any]:
        """Identify the bottleneck node on the critical path."""
        from .analysis import bottleneck_analysis

        return bottleneck_analysis(self._steps, costs)

    def visualize(self, fmt: str = "mermaid") -> str:
        """Render the workflow DAG as a diagram string.

        Args:
            fmt: Output format — ``"mermaid"`` or ``"dot"``.

        Returns:
            The diagram string (no statuses — pre-execution view).
        """
        from .visualization import (
            nodes_and_edges_from_steps,
            render_dot,
            render_mermaid,
        )

        nodes, edges = nodes_and_edges_from_steps(self._steps)
        if fmt == "dot":
            return render_dot(nodes, edges)
        return render_mermaid(nodes, edges)

    def _compile(
        self, queue: Queue
    ) -> tuple[
        bytes,
        str,
        dict[str, bytes],
        list[str],
        dict[str, Any],
        str,
        dict[str, GateConfig],
        dict[str, SubWorkflowRef],
    ]:
        """Produce compile output for ``Queue.submit_workflow``.

        Returns:
            ``(dag_bytes, step_metadata_json, node_payloads, deferred_nodes,
            callable_conditions, on_failure, gate_configs, sub_workflow_refs)``
        """
        from taskito._taskito import PyWorkflowBuilder

        builder = PyWorkflowBuilder()
        node_payloads: dict[str, bytes] = {}
        callable_conditions: dict[str, Any] = {}
        gate_configs: dict[str, GateConfig] = {}
        sub_workflow_refs: dict[str, SubWorkflowRef] = {}

        has_conditions = any(s.condition is not None for s in self._steps.values())
        has_gates = any(s.gate_config is not None for s in self._steps.values())
        has_sub_wf = any(s.sub_workflow is not None for s in self._steps.values())
        is_continue = self.on_failure != "fail_fast"

        # Compute the set of deferred nodes.
        deferred: set[str] = set()
        for step in self._steps.values():
            if (
                step.fan_out is not None
                or step.fan_in is not None
                or step.condition is not None
                or step.gate_config is not None
                or step.sub_workflow is not None
            ) or ((has_conditions or is_continue or has_gates or has_sub_wf) and step.after):
                deferred.add(step.name)
        # Propagate: a step is deferred if any predecessor is deferred.
        changed = True
        while changed:
            changed = False
            for step in self._steps.values():
                if step.name in deferred:
                    continue
                if any(pred in deferred for pred in step.after):
                    deferred.add(step.name)
                    changed = True

        for step in self._steps.values():
            str_condition: str | None = None
            if isinstance(step.condition, str):
                str_condition = step.condition
            elif callable(step.condition):
                callable_conditions[step.name] = step.condition
                str_condition = "callable"

            if step.gate_config is not None:
                gate_configs[step.name] = step.gate_config
            if step.sub_workflow is not None:
                sub_workflow_refs[step.name] = step.sub_workflow

            builder.add_step(
                step.name,
                step.task_name,
                step.after if step.after else None,
                step.queue,
                step.max_retries,
                step.timeout_ms,
                step.priority,
                None,
                None,
                step.fan_out,
                step.fan_in,
                str_condition,
            )
            # Gate, fan-out, fan-in, and sub-workflow steps have no payload.
            if (
                step.gate_config is None
                and step.fan_out is None
                and step.fan_in is None
                and step.sub_workflow is None
            ):
                serializer = queue._get_serializer(step.task_name)
                node_payloads[step.name] = serializer.dumps((step.args, step.kwargs))

        dag_bytes, step_metadata_json = builder.serialize()
        return (
            dag_bytes,
            step_metadata_json,
            node_payloads,
            sorted(deferred),
            callable_conditions,
            self.on_failure,
            gate_configs,
            sub_workflow_refs,
        )


@dataclass
class SubWorkflowRef:
    """Marker returned by :meth:`WorkflowProxy.as_step`."""

    proxy: WorkflowProxy
    params: dict[str, Any] = field(default_factory=dict)

    # Duck-type as a task so Workflow.step() accepts it.
    @property
    def _task_name(self) -> str:
        return f"__subworkflow__{self.proxy._name}"


class WorkflowProxy:
    """Returned by ``@queue.workflow()`` — callable that builds and submits."""

    _is_workflow_proxy: bool = True

    def __init__(
        self,
        queue: Queue,
        name: str,
        version: int,
        factory: Callable[..., Workflow],
    ):
        self._queue = queue
        self._name = name
        self._version = version
        self._factory = factory

    def as_step(self, **params: Any) -> SubWorkflowRef:
        """Return a reference that can be passed to ``Workflow.step()``."""
        return SubWorkflowRef(proxy=self, params=params)

    def build(self, *args: Any, **kwargs: Any) -> Workflow:
        """Materialize the workflow without submitting it."""
        wf = self._factory(*args, **kwargs)
        if not isinstance(wf, Workflow):
            raise TypeError(f"@queue.workflow('{self._name}') factory must return a Workflow")
        wf.name = self._name
        wf.version = self._version
        return wf

    def submit(self, *args: Any, **kwargs: Any) -> WorkflowRun:
        """Build and submit the workflow in one call."""
        wf = self.build(*args, **kwargs)
        return self._queue.submit_workflow(wf)

    def __call__(self, *args: Any, **kwargs: Any) -> Workflow:
        return self.build(*args, **kwargs)
