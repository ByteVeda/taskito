"""Prefork child worker process.

Each child is an independent Python interpreter that:
1. Imports the app module and builds the task registry.
2. Initializes resources (if any).
3. Reads JSON job messages from stdin, executes tasks, writes JSON results to stdout.

Spawned by the Rust ``PreforkPool`` via ``python -m taskito.prefork <app_path>``.
"""

from __future__ import annotations

import base64
import importlib
import json
import logging
import os
import sys
import time
import traceback
from typing import Any

from taskito.async_support.helpers import run_maybe_async
from taskito.exceptions import TaskCancelledError

logger = logging.getLogger("taskito.prefork.child")


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

    # Set job context
    from taskito.context import _clear_context, _set_context

    _set_context(job_id, task_name, retry_count, job.get("queue", "default"))

    start_ns = time.monotonic_ns()
    try:
        # Deserialize payload
        args, kwargs = queue._deserialize_payload(task_name, payload)

        # Call the wrapped task function (handles middleware, resources, proxies)
        result = run_maybe_async(wrapper(*args, **kwargs))

        # Serialize result
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

        # Check retry filters
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


def main() -> None:
    """Child process main loop. Called via ``python -m taskito.prefork <app_path>``."""
    if len(sys.argv) < 2:
        sys.stderr.write("Usage: python -m taskito.prefork <app_path>\n")
        sys.exit(1)

    app_path = sys.argv[1]

    # Ensure the working directory is on sys.path so module imports
    # resolve the same way as in the parent process.
    cwd = os.getcwd()
    if cwd not in sys.path:
        sys.path.insert(0, cwd)

    # Import the queue and set up context
    queue = _import_queue(app_path)
    from taskito.context import _set_queue_ref

    _set_queue_ref(queue)

    # Initialize resources if any are defined
    runtime = queue._resource_runtime
    if runtime is not None:
        runtime.initialize()

    # Signal readiness
    _write_message({"type": "ready"})
    logger.info("child ready (app=%s, pid=%d)", app_path, os.getpid())

    # Main loop: read jobs from stdin, execute, write results to stdout
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue

            msg = json.loads(line)

            if msg.get("type") == "shutdown":
                sys.stdout.flush()
                break

            if msg.get("type") == "job":
                result = _execute_job(queue, msg)
                _write_message(result)

    except (BrokenPipeError, EOFError, KeyboardInterrupt):
        logger.debug("child pipe closed or interrupted")

    finally:
        # Teardown resources
        if runtime is not None:
            try:
                runtime.teardown()
            except Exception:
                logger.warning("resource teardown error", exc_info=True)
