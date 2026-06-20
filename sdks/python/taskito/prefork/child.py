"""Prefork child worker process.

Each child is an independent Python interpreter that:
1. Imports the app module and builds the task registry.
2. Initializes resources (if any).
3. Runs a stdin reader thread that demultiplexes ``job``, ``cancel``, and
   ``shutdown`` messages from the parent. Jobs go on an internal queue;
   cancels populate a local set that ``current_job.check_cancelled()`` reads
   via a registered hook.
4. Pulls jobs off the internal queue on the main thread, executes them,
   and writes JSON results to stdout.

Spawned by the Rust ``PreforkPool`` via ``python -m taskito.prefork <app_path>``.
"""

from __future__ import annotations

import base64
import importlib
import json
import logging
import os
import queue as _queue_mod
import signal
import sys
import threading
import time
import traceback
from typing import Any

from taskito.async_support.helpers import run_maybe_async
from taskito.context import (
    _clear_context,
    _set_context,
    _set_queue_ref,
    clear_local_cancel_check,
    set_local_cancel_check,
)
from taskito.exceptions import TaskCancelledError
from taskito.log_config import silence_asyncio_pipe_noise

logger = logging.getLogger("taskito.prefork.child")

# Sentinel pushed onto the internal job queue when the parent requests
# shutdown so the main loop can terminate without polling.
_SHUTDOWN_SENTINEL: dict[str, Any] = {"__shutdown__": True}


def _import_queue(app_path: str) -> Any:
    """Import and return the Queue instance from a dotted path like 'myapp:queue'."""
    if ":" not in app_path:
        raise ValueError(f"Invalid app path '{app_path}': expected 'module:attribute' format")
    module_path, attr_name = app_path.rsplit(":", 1)
    module = importlib.import_module(module_path)
    queue = getattr(module, attr_name)
    return queue


def _write_message(msg: dict[str, Any]) -> None:
    """Write a JSON message to stdout (one line, flushed)."""
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


class _CancelSignal:
    """Thread-safe set of job IDs the parent has asked us to cancel.

    Cancel messages may arrive before, during, or after the job they target;
    keeping the IDs around until the corresponding result is written means
    a cancel that races a job's start still fires deterministically.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._ids: set[str] = set()

    def request(self, job_id: str) -> None:
        with self._lock:
            self._ids.add(job_id)

    def is_requested(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._ids

    def discard(self, job_id: str) -> None:
        with self._lock:
            self._ids.discard(job_id)


def _execute_job(
    queue: Any,
    job: dict[str, Any],
) -> dict[str, Any]:
    """Execute a single job and return the result message."""
    task_name = job["task_name"]
    job_id = job["id"]
    payload = base64.b64decode(job["payload"])
    retry_count = job.get("retry_count", 0)
    max_retries = job.get("max_retries", 3)

    logger.debug("executing %s[%s]", task_name, job_id)
    wrapper = queue._task_registry.get(task_name)
    if wrapper is None:
        return {
            "type": "failure",
            "job_id": job_id,
            "error": f"task '{task_name}' not registered",
            "retry_count": retry_count,
            "max_retries": max_retries,
            "task_name": task_name,
            "wall_time_ns": 0,
            "should_retry": False,
            "timed_out": False,
        }

    _set_context(job_id, task_name, retry_count, job.get("queue", "default"))

    start_ns = time.monotonic_ns()
    try:
        args, kwargs = queue._deserialize_payload(task_name, payload)
        result = run_maybe_async(wrapper(*args, **kwargs))
        result_bytes = queue._serializer.dumps(result) if result is not None else None
        wall_time_ns = time.monotonic_ns() - start_ns

        return {
            "type": "success",
            "job_id": job_id,
            "result": base64.b64encode(result_bytes).decode() if result_bytes else None,
            "task_name": task_name,
            "wall_time_ns": wall_time_ns,
        }

    except TaskCancelledError:
        wall_time_ns = time.monotonic_ns() - start_ns
        return {
            "type": "cancelled",
            "job_id": job_id,
            "task_name": task_name,
            "wall_time_ns": wall_time_ns,
        }

    except Exception:
        wall_time_ns = time.monotonic_ns() - start_ns
        error_msg = traceback.format_exc()
        logger.error("task %s[%s] failed: %s", task_name, job_id, error_msg.splitlines()[-1])

        should_retry = True
        filters = queue._task_retry_filters.get(task_name)
        if filters:
            exc = sys.exc_info()[1]
            dont_retry_on = filters.get("dont_retry_on", [])
            for cls in dont_retry_on:
                if isinstance(exc, cls):
                    should_retry = False
                    break
            if should_retry:
                retry_on = filters.get("retry_on", [])
                if retry_on:
                    should_retry = any(isinstance(exc, cls) for cls in retry_on)

        return {
            "type": "failure",
            "job_id": job_id,
            "error": error_msg,
            "retry_count": retry_count,
            "max_retries": max_retries,
            "task_name": task_name,
            "wall_time_ns": wall_time_ns,
            "should_retry": should_retry,
            "timed_out": False,
        }

    finally:
        _clear_context()


def _spawn_stdin_reader(
    job_queue: _queue_mod.Queue[dict[str, Any]],
    cancels: _CancelSignal,
) -> threading.Thread:
    """Run a background thread that demultiplexes parent → child messages.

    The main thread is blocked inside ``_execute_job`` while a job is
    running, so reading stdin must happen elsewhere. This thread converts
    the line-delimited JSON stream into queue items + cancel-set updates.
    """

    def reader() -> None:
        try:
            for line in sys.stdin:
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError as e:
                    logger.warning("invalid IPC message from parent: %s", e)
                    continue

                msg_type = msg.get("type")
                if msg_type == "shutdown":
                    job_queue.put(_SHUTDOWN_SENTINEL)
                    return
                if msg_type == "job":
                    job_queue.put(msg)
                elif msg_type == "cancel":
                    job_id = msg.get("job_id")
                    if isinstance(job_id, str):
                        cancels.request(job_id)
                else:
                    logger.warning("unknown IPC message type: %r", msg_type)
        except (BrokenPipeError, EOFError, KeyboardInterrupt):
            logger.debug("child stdin closed")
        finally:
            # Ensure the main loop wakes up even if stdin closed without a
            # shutdown message (e.g. the parent died).
            job_queue.put(_SHUTDOWN_SENTINEL)

    thread = threading.Thread(target=reader, name="taskito-prefork-stdin", daemon=True)
    thread.start()
    return thread


def _install_shutdown_signal_handler() -> None:
    """Mute asyncio's spurious 'pipe closed by peer' WARNING when SIGINT
    arrives, then re-raise ``KeyboardInterrupt`` so the main loop's existing
    cleanup path still runs. Subprocesses the user task spawned (Playwright
    browsers etc.) get the same SIGINT via the foreground process group and
    flood the asyncio logger as they die; the warning is informational only
    (asyncio already swallowed the underlying error) so demoting it to DEBUG
    keeps the child's output readable."""
    if threading.current_thread() is not threading.main_thread():
        return

    def handler(signum: int, frame: Any) -> None:
        silence_asyncio_pipe_noise()
        raise KeyboardInterrupt

    signal.signal(signal.SIGINT, handler)


def main() -> None:
    """Child process main loop. Called via ``python -m taskito.prefork <app_path>``."""
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: python -m taskito.prefork <app_path>\n")
        sys.exit(1)

    _install_shutdown_signal_handler()

    app_path = sys.argv[1]

    # Ensure the working directory is on sys.path so module imports
    # resolve the same way as in the parent process.
    cwd = os.getcwd()
    if cwd not in sys.path:
        sys.path.insert(0, cwd)

    queue = _import_queue(app_path)
    _set_queue_ref(queue)

    runtime = queue._resource_runtime
    if runtime is not None:
        runtime.initialize()

    job_queue: _queue_mod.Queue[dict[str, Any]] = _queue_mod.Queue()
    cancels = _CancelSignal()
    set_local_cancel_check(cancels.is_requested)
    _spawn_stdin_reader(job_queue, cancels)

    _write_message({"type": "ready"})
    logger.info("child ready (app=%s, pid=%d)", app_path, os.getpid())

    try:
        while True:
            msg = job_queue.get()
            if msg is _SHUTDOWN_SENTINEL:
                break
            result = _execute_job(queue, msg)
            _write_message(result)
            # Drop the cancel marker once the result is written so a future
            # job with the same ID (extremely unlikely, but possible across
            # ID-reuse boundaries) does not auto-cancel.
            cancels.discard(result.get("job_id", ""))
    except (BrokenPipeError, EOFError, KeyboardInterrupt):
        logger.debug("child output pipe closed or interrupted")

    finally:
        clear_local_cancel_check()
        if runtime is not None:
            try:
                runtime.teardown()
            except Exception:
                logger.warning("resource teardown error", exc_info=True)
