"""Tests for Phase 5A approval gates."""

from __future__ import annotations

import threading
import time

from taskito import Queue
from taskito.workflows import NodeStatus, Workflow, WorkflowState


def _start_worker(queue: Queue) -> threading.Thread:
    thread = threading.Thread(target=queue.run_worker, daemon=True)
    thread.start()
    return thread


def _stop_worker(queue: Queue, thread: threading.Thread) -> None:
    queue._inner.request_shutdown()
    thread.join(timeout=5)


def test_gate_pauses_workflow(queue: Queue) -> None:
    """A gate node enters WAITING_APPROVAL and blocks downstream."""

    @queue.task()
    def ok_task() -> str:
        return "ok"

    wf = Workflow(name="gate_pause")
    wf.step("a", ok_task)
    wf.gate("approve", after="a")
    wf.step("b", ok_task, after="approve")

    worker = _start_worker(queue)
    try:
        run = queue.submit_workflow(wf)
        time.sleep(3)  # Let "a" complete
        snapshot = run.status()
    finally:
        _stop_worker(queue, worker)

    assert snapshot.state == WorkflowState.RUNNING
    assert snapshot.nodes["a"].status == NodeStatus.COMPLETED
    assert snapshot.nodes["approve"].status == NodeStatus.WAITING_APPROVAL
    assert snapshot.nodes["b"].status == NodeStatus.PENDING


def test_approve_gate_resumes(queue: Queue) -> None:
    """Approving a gate lets downstream steps run to completion."""

    collected: list[str] = []

    @queue.task()
    def ok_task() -> str:
        collected.append("ran")
        return "ok"

    wf = Workflow(name="gate_approve")
    wf.step("a", ok_task)
    wf.gate("approve", after="a")
    wf.step("b", ok_task, after="approve")

    worker = _start_worker(queue)
    try:
        run = queue.submit_workflow(wf)
        time.sleep(2)  # Let "a" complete and gate enter WAITING_APPROVAL
        queue.approve_gate(run.id, "approve")
        final = run.wait(timeout=15)
    finally:
        _stop_worker(queue, worker)

    assert final.state == WorkflowState.COMPLETED
    assert final.nodes["approve"].status == NodeStatus.COMPLETED
    assert final.nodes["b"].status == NodeStatus.COMPLETED
    assert len(collected) == 2  # "a" and "b"


def test_reject_gate_fails(queue: Queue) -> None:
    """Rejecting a gate fails it and skips downstream."""

    @queue.task()
    def ok_task() -> str:
        return "ok"

    wf = Workflow(name="gate_reject")
    wf.step("a", ok_task)
    wf.gate("approve", after="a")
    wf.step("b", ok_task, after="approve")

    worker = _start_worker(queue)
    try:
        run = queue.submit_workflow(wf)
        time.sleep(2)
        queue.reject_gate(run.id, "approve", error="not approved")
        final = run.wait(timeout=15)
    finally:
        _stop_worker(queue, worker)

    assert final.state == WorkflowState.FAILED
    assert final.nodes["approve"].status == NodeStatus.FAILED
    assert final.nodes["b"].status == NodeStatus.SKIPPED


def test_gate_timeout_reject(queue: Queue) -> None:
    """Gate with timeout and on_timeout='reject' auto-rejects."""

    @queue.task()
    def ok_task() -> str:
        return "ok"

    wf = Workflow(name="gate_timeout_reject")
    wf.step("a", ok_task)
    wf.gate("approve", after="a", timeout=1.0, on_timeout="reject")
    wf.step("b", ok_task, after="approve")

    worker = _start_worker(queue)
    try:
        run = queue.submit_workflow(wf)
        final = run.wait(timeout=15)
    finally:
        _stop_worker(queue, worker)

    assert final.state == WorkflowState.FAILED
    assert final.nodes["approve"].status == NodeStatus.FAILED
    assert final.nodes["approve"].error is not None
    assert "timeout" in (final.nodes["approve"].error or "").lower()


def test_gate_timeout_approve(queue: Queue) -> None:
    """Gate with on_timeout='approve' auto-approves and continues."""

    collected: list[str] = []

    @queue.task()
    def ok_task() -> str:
        collected.append("ran")
        return "ok"

    wf = Workflow(name="gate_timeout_approve")
    wf.step("a", ok_task)
    wf.gate("approve", after="a", timeout=1.0, on_timeout="approve")
    wf.step("b", ok_task, after="approve")

    worker = _start_worker(queue)
    try:
        run = queue.submit_workflow(wf)
        final = run.wait(timeout=15)
    finally:
        _stop_worker(queue, worker)

    assert final.state == WorkflowState.COMPLETED
    assert final.nodes["approve"].status == NodeStatus.COMPLETED
    assert final.nodes["b"].status == NodeStatus.COMPLETED


def test_gate_with_condition(queue: Queue) -> None:
    """A gate with condition='on_success' respects predecessor state."""

    @queue.task(max_retries=0)
    def fail_task() -> str:
        raise RuntimeError("fail")

    @queue.task()
    def ok_task() -> str:
        return "ok"

    wf = Workflow(name="gate_condition")
    wf.step("a", fail_task)
    wf.gate("approve", after="a", condition="on_success")
    wf.step("b", ok_task, after="approve")

    worker = _start_worker(queue)
    try:
        run = queue.submit_workflow(wf)
        final = run.wait(timeout=15)
    finally:
        _stop_worker(queue, worker)

    assert final.state == WorkflowState.FAILED
    # Gate should be skipped because predecessor failed (condition=on_success)
    assert final.nodes["approve"].status == NodeStatus.SKIPPED
    assert final.nodes["b"].status == NodeStatus.SKIPPED
