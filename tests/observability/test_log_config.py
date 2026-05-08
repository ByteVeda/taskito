"""Tests for the central log configuration module."""

from __future__ import annotations

import io
import logging
from collections.abc import Iterator

import pytest

from taskito import log_config
from taskito.log_config import (
    DEFAULT_DATEFMT,
    DEFAULT_FORMAT,
    configure,
)

_MANAGED_LOGGERS = (
    "taskito",
    "taskito_core",
    "taskito_python",
    "taskito_async",
    "taskito_workflows",
)


@pytest.fixture(autouse=True)
def _reset_taskito_loggers() -> Iterator[None]:
    """Strip any handlers/state on the taskito loggers between tests.

    The module keeps a process-wide cache so tests must isolate themselves
    from each other (and from anything an earlier import may have set up).
    """
    log_config._LAST_CONFIG = None
    for name in _MANAGED_LOGGERS:
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.setLevel(logging.NOTSET)
        logger.propagate = True
    yield
    log_config._LAST_CONFIG = None
    for name in _MANAGED_LOGGERS:
        logger = logging.getLogger(name)
        logger.handlers.clear()
        logger.setLevel(logging.NOTSET)
        logger.propagate = True


def test_configure_attaches_handler_to_all_known_loggers() -> None:
    stream = io.StringIO()
    configure(level="DEBUG", stream=stream)

    for name in _MANAGED_LOGGERS:
        logger = logging.getLogger(name)
        managed = [h for h in logger.handlers if getattr(h, "_taskito_managed", False)]
        assert len(managed) == 1, f"{name} should have exactly one managed handler"
        assert logger.level == logging.DEBUG


def test_configure_is_idempotent_for_identical_calls() -> None:
    stream = io.StringIO()
    configure(level="INFO", stream=stream)
    handler_before = logging.getLogger("taskito").handlers[0]

    configure(level="INFO", stream=stream)
    handler_after = logging.getLogger("taskito").handlers[0]

    assert handler_before is handler_after, "no-op call must not rebuild the handler"
    assert len(logging.getLogger("taskito").handlers) == 1


def test_configure_swaps_handler_when_level_changes() -> None:
    stream = io.StringIO()
    configure(level="INFO", stream=stream)
    first = logging.getLogger("taskito").handlers[0]

    configure(level="DEBUG", stream=stream)
    second = logging.getLogger("taskito").handlers[0]

    assert first is not second
    assert logging.getLogger("taskito").level == logging.DEBUG
    # Still exactly one managed handler — the old one was detached.
    assert len(logging.getLogger("taskito").handlers) == 1


def test_configure_leaves_caller_handlers_alone() -> None:
    stream = io.StringIO()
    foreign = logging.StreamHandler(io.StringIO())
    logging.getLogger("taskito").addHandler(foreign)

    configure(level="INFO", stream=stream)
    handlers = logging.getLogger("taskito").handlers
    assert foreign in handlers, "caller-installed handlers must be preserved"
    managed = [h for h in handlers if getattr(h, "_taskito_managed", False)]
    assert len(managed) == 1


def test_level_resolution_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TASKITO_LOG_LEVEL", "WARNING")
    configure()
    assert logging.getLogger("taskito").level == logging.WARNING


def test_level_resolution_falls_back_to_info(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TASKITO_LOG_LEVEL", raising=False)
    configure()
    assert logging.getLogger("taskito").level == logging.INFO


def test_default_format_emits_am_pm_timestamp() -> None:
    stream = io.StringIO()
    configure(level="INFO", stream=stream)

    logging.getLogger("taskito").info("hello")
    output = stream.getvalue()

    assert "INFO" in output
    assert "hello" in output
    assert ("AM" in output) or ("PM" in output), "default datefmt must include AM/PM marker"


def test_format_constants_are_stable() -> None:
    # Catch accidental drift in the default format strings — these are part of
    # the public surface (downstream tools that grep logs may rely on them).
    assert DEFAULT_FORMAT == "[%(asctime)s] %(levelname)s %(message)s"
    assert "%p" in DEFAULT_DATEFMT
