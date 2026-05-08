"""Central log configuration for taskito.

A single entry point — :func:`configure` — owns the ``taskito`` Python logger
and the parallel logger names that PyO3-log uses for Rust crates
(``taskito_core``, ``taskito_python``, ``taskito_async``, ``taskito_workflows``).
Calling it more than once is a no-op when the resolved settings haven't
changed; passing different arguments swaps the managed handler in place
rather than stacking handlers.

The Rust side is bridged into Python's :mod:`logging` by ``pyo3_log::try_init``
inside the ``_taskito`` extension module init, so a single configure call
captures Rust ``log::*`` output too.
"""

from __future__ import annotations

import logging
import os
import sys
import threading
from typing import TextIO

from taskito._taskito import _init_rust_logging

__all__ = ["DEFAULT_DATEFMT", "DEFAULT_FORMAT", "configure"]

DEFAULT_FORMAT = "[%(asctime)s] %(levelname)s %(message)s"
DEFAULT_DATEFMT = "%Y-%m-%d %I:%M:%S %p"

# Logger names that taskito emits under. The Python logger is well-known;
# the Rust ones are derived from cargo crate names (``_`` form) by pyo3-log.
_PY_LOGGER = "taskito"
_RUST_LOGGERS = (
    "taskito_core",
    "taskito_python",
    "taskito_async",
    "taskito_workflows",
)
_ALL_LOGGERS = (_PY_LOGGER, *_RUST_LOGGERS)

# Sentinel attribute set on a handler we manage, so we never double-attach
# and we leave caller-installed handlers untouched.
_OWN_HANDLER_ATTR = "_taskito_managed"

# Guards concurrent calls to ``configure`` from multiple threads (CLI startup
# vs. ``Queue.run_worker`` background thread).
_CONFIG_LOCK = threading.Lock()

# Cached signature of the last successful configure() call, so identical
# repeat calls short-circuit instead of churning handlers.
_LAST_CONFIG: tuple[int, int] | None = None


def _resolve_level(level: int | str | None) -> int:
    """Resolve a level argument or ``TASKITO_LOG_LEVEL`` env var to a logging int."""
    if level is None:
        level = os.environ.get("TASKITO_LOG_LEVEL", "INFO")
    if isinstance(level, str):
        try:
            return int(level)
        except ValueError:
            pass
        resolved = logging.getLevelName(level.upper())
        if isinstance(resolved, int):
            return resolved
        return logging.INFO
    return level


def _build_handler(stream: TextIO) -> logging.Handler:
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logging.Formatter(DEFAULT_FORMAT, datefmt=DEFAULT_DATEFMT))
    setattr(handler, _OWN_HANDLER_ATTR, True)
    return handler


def _detach_managed(logger: logging.Logger) -> None:
    for existing in list(logger.handlers):
        if getattr(existing, _OWN_HANDLER_ATTR, False):
            logger.removeHandler(existing)


def configure(
    level: int | str | None = None,
    *,
    stream: TextIO | None = None,
) -> logging.Logger:
    """Configure the central ``taskito`` logger and its Rust counterparts.

    Idempotent: identical repeat calls are no-ops; argument changes swap the
    managed handler in place rather than stacking handlers. Caller-installed
    handlers on the same loggers are left intact.

    Args:
        level: Logging level as an int (e.g. ``logging.DEBUG``) or string
            (``"INFO"``). Falls back to ``TASKITO_LOG_LEVEL``, then ``INFO``.
        stream: Where to write log lines. Defaults to ``sys.stderr``.

    Returns:
        The configured ``taskito`` Python logger.
    """
    global _LAST_CONFIG

    resolved_level = _resolve_level(level)
    target_stream = stream if stream is not None else sys.stderr
    signature = (resolved_level, id(target_stream))

    with _CONFIG_LOCK:
        if signature == _LAST_CONFIG:
            return logging.getLogger(_PY_LOGGER)

        # Activate the Rust → Python log bridge once. Doing this here (rather
        # than from `_taskito` module init) avoids a deadlock during cold
        # imports where the GIL is held by a blocking connection-pool retry.
        _init_rust_logging()

        handler = _build_handler(target_stream)
        for name in _ALL_LOGGERS:
            logger = logging.getLogger(name)
            _detach_managed(logger)
            logger.addHandler(handler)
            logger.setLevel(resolved_level)
            # Leave `propagate` alone. Embedded hosts (Django, FastAPI) that
            # already have a root handler can set `propagate = False` on the
            # `taskito` logger themselves to avoid duplicate lines; flipping
            # it here would silently break pytest `caplog` and any other
            # consumer that listens at the root.

        _LAST_CONFIG = signature
        return logging.getLogger(_PY_LOGGER)
