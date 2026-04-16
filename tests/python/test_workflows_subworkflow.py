"""Tests for Phase 5B sub-workflows."""

from __future__ import annotations

import threading

from taskito import Queue
from taskito.workflows import NodeStatus, Workflow, WorkflowState


def _start_worker(queue: Queue) -> threading.Thread:
    thread = threading.Thread(target=queue.run_worker, daemon=True)
    thread.start()
    return thread


def _stop_worker(queue: Queue, thread: threading.Thread) -> None:
    queue._inner.request_shutdown()
    thread.join(timeout=5)


def test_sub_workflow_executes(queue: Queue) -> None:
    """A sub-workflow step runs the child workflow, parent continues after."""

    order: list[str] = []

    @queue.task()
    def extract() -> str:
        order.append("extract")
        return "data"

    @queue.task()
    def load() -> str:
        order.append("load")
        return "loaded"

    @queue.task()
    def report() -> str:
        order.append("report")
        return "done"

    @queue.workflow("etl")
    def etl_pipeline() -> Workflow:
        wf = Workflow()
        wf.step("extract", extract)
        wf.step("load", load, after="extract")
        return wf

    wf = Workflow(name="parent")
    wf.step("etl", etl_pipeline.as_step())
    wf.step("report", report, after="etl")

    worker = _start_worker(queue)
    try:
        run = queue.submit_workflow(wf)
        final = run.wait(timeout=20)
    finally:
        _stop_worker(queue, worker)

    assert final.state == WorkflowState.COMPLETED
    assert "extract" in order
    assert "load" in order
    assert "report" in order
    assert order.index("load") < order.index("report")


def test_sub_workflow_failure(queue: Queue) -> None:
    """A failing sub-workflow fails the parent node."""

    @queue.task(max_retries=0)
    def fail_task() -> str:
        raise RuntimeError("sub failed")

    @queue.task()
    def ok_task() -> str:
        return "ok"

    @queue.workflow("failing_sub")
    def failing_sub() -> Workflow:
        wf = Workflow()
        wf.step("boom", fail_task)
        return wf

    wf = Workflow(name="parent_fail")
    wf.step("sub", failing_sub.as_step())
    wf.step("after", ok_task, after="sub")

    worker = _start_worker(queue)
    try:
        run = queue.submit_workflow(wf)
        final = run.wait(timeout=20)
    finally:
        _stop_worker(queue, worker)

    assert final.state == WorkflowState.FAILED
    assert final.nodes["sub"].status == NodeStatus.FAILED
    assert final.nodes["after"].status == NodeStatus.SKIPPED


def test_cancel_parent_cascades(queue: Queue) -> None:
    """Cancelling a parent workflow cancels the child sub-workflow too."""

    import time

    @queue.task()
    def slow_task() -> str:
        time.sleep(30)
        return "slow"

    @queue.workflow("slow_sub")
    def slow_sub() -> Workflow:
        wf = Workflow()
        wf.step("slow", slow_task)
        return wf

    wf = Workflow(name="parent_cancel")
    wf.step("sub", slow_sub.as_step())

    worker = _start_worker(queue)
    try:
        run = queue.submit_workflow(wf)
        time.sleep(2)  # Let sub-workflow submit
        run.cancel()
        snapshot = run.status()
    finally:
        _stop_worker(queue, worker)

    assert snapshot.state == WorkflowState.CANCELLED


def test_parallel_sub_workflows(queue: Queue) -> None:
    """Two sub-workflows can run concurrently."""

    order: list[str] = []

    @queue.task()
    def task_a() -> str:
        order.append("a")
        return "a"

    @queue.task()
    def task_b() -> str:
        order.append("b")
        return "b"

    @queue.task()
    def reconcile() -> str:
        order.append("reconcile")
        return "done"

    @queue.workflow("sub_a")
    def sub_a() -> Workflow:
        wf = Workflow()
        wf.step("a", task_a)
        return wf

    @queue.workflow("sub_b")
    def sub_b() -> Workflow:
        wf = Workflow()
        wf.step("b", task_b)
        return wf

    wf = Workflow(name="parallel_parent")
    wf.step("sa", sub_a.as_step())
    wf.step("sb", sub_b.as_step())
    wf.step("reconcile", reconcile, after=["sa", "sb"])

    worker = _start_worker(queue)
    try:
        run = queue.submit_workflow(wf)
        final = run.wait(timeout=20)
    finally:
        _stop_worker(queue, worker)

    assert final.state == WorkflowState.COMPLETED
    assert "a" in order
    assert "b" in order
    assert "reconcile" in order
