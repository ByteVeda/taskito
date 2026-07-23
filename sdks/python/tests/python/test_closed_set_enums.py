"""Closed-set options accept an enum or its wire string, and reject anything else."""

from __future__ import annotations

from pathlib import Path

import pytest

from taskito import InterceptionMode, PredicateAction, Queue
from taskito.mixins._log_consumer import ConsumerErrorAction
from taskito.workflows.types import DiagramFormat, FanStrategy, GateAction


def test_wire_values_are_the_cross_sdk_contract() -> None:
    """The persisted/wire form of every closed set is its lowercase string."""
    assert InterceptionMode.STRICT.value == "strict"
    assert PredicateAction.CANCEL.value == "cancel"
    assert ConsumerErrorAction.SKIP.value == "skip"
    assert GateAction.APPROVE.value == "approve"
    assert FanStrategy.EACH.value == "each"
    assert DiagramFormat.DOT.value == "dot"
    # A (str, Enum) member carries its value as its string content, which is what
    # the native layer reads — str() would render "FanStrategy.EACH" instead.
    assert FanStrategy.EACH.encode() == b"each"


def test_interception_accepts_enum_and_string(tmp_path: Path) -> None:
    enum_queue = Queue(db_path=str(tmp_path / "a.db"), interception=InterceptionMode.LENIENT)
    string_queue = Queue(db_path=str(tmp_path / "b.db"), interception="lenient")
    try:
        assert enum_queue._interceptor is not None
        assert enum_queue._interceptor.mode is InterceptionMode.LENIENT
        assert string_queue._interceptor is not None
        assert string_queue._interceptor.mode is InterceptionMode.LENIENT
    finally:
        enum_queue.close()
        string_queue.close()


def test_interception_typo_raises_naming_the_valid_set(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="'strict', 'lenient', 'off'"):
        Queue(db_path=str(tmp_path / "c.db"), interception="strictt")


def test_on_false_accepts_enum_and_string(queue: Queue) -> None:
    @queue.task(predicate=lambda: False, on_false=PredicateAction.CANCEL)
    def cancels() -> None:
        """Registered only to record its on_false setting."""

    @queue.task(predicate=lambda: False, on_false="defer")
    def defers() -> None:
        """Registered only to record its on_false setting."""

    stored = queue._task_predicate_on_false
    assert stored[cancels._task_name] is PredicateAction.CANCEL
    assert stored[defers._task_name] is PredicateAction.DEFER


def test_on_false_typo_raises(queue: Queue) -> None:
    with pytest.raises(ValueError, match="'defer', 'cancel'"):

        @queue.task(predicate=lambda: False, on_false="canccel")
        def bad() -> None:
            """Never registered — the option is rejected first."""


def test_log_consumer_on_error_typo_raises(queue: Queue) -> None:
    with pytest.raises(ValueError, match="'retry', 'skip'"):

        @queue.log_consumer("topic", on_error="ignore")
        def bad(message: object) -> None:
            """Never registered — the option is rejected first."""


def test_unknown_visualize_format_raises_instead_of_defaulting(queue: Queue) -> None:
    """Previously anything that wasn't 'dot' silently rendered Mermaid."""
    from taskito.workflows import Workflow

    @queue.task()
    def step() -> None:
        """A single node, enough to render."""

    workflow = Workflow("wf").step("a", step)
    assert workflow.visualize(DiagramFormat.DOT).startswith("digraph")
    assert "graph" in workflow.visualize("mermaid")
    with pytest.raises(ValueError, match="'mermaid', 'dot'"):
        workflow.visualize("graphviz")
