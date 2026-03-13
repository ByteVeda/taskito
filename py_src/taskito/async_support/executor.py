"""AsyncTaskExecutor — dedicated event loop for native async task execution."""

from __future__ import annotations

import asyncio
import logging
import threading
import time
import traceback
from typing import TYPE_CHECKING, Any

import cloudpickle

from taskito.async_support.context import clear_async_context, set_async_context
from taskito.exceptions import TaskCancelledError
from taskito.interception.reconstruct import reconstruct_args
from taskito.proxies import cleanup_proxies, reconstruct_proxies

if TYPE_CHECKING:
    from taskito.app import Queue

logger = logging.getLogger("taskito.async")


class AsyncTaskExecutor:
    """Runs async tasks natively on a dedicated event loop.

    Receives jobs from Rust via :meth:`submit_job`, executes the async coroutine
    with full lifecycle support (interception, proxies, resource injection,
    middleware), and reports results back via a ``PyResultSender``.
    """

    def __init__(
        self,
        result_sender: Any,
        task_registry: dict[str, Any],
        queue_ref: Queue,
        max_concurrency: int = 100,
    ) -> None:
        self._sender = result_sender
        self._registry = task_registry
        self._queue_ref = queue_ref
        self._max_concurrency = max_concurrency
        self._semaphore: asyncio.Semaphore | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        """Start the dedicated event loop thread."""
        self._loop = asyncio.new_event_loop()
        self._semaphore = asyncio.Semaphore(self._max_concurrency)
        self._thread = threading.Thread(
            target=self._loop.run_forever,
            daemon=True,
            name="taskito-async-executor",
        )
        self._thread.start()

    def submit_job(
        self,
        job_id: str,
        task_name: str,
        payload: bytes,
        retry_count: int,
        max_retries: int,
        queue_name: str,
    ) -> None:
        """Submit an async job for execution. Called from Rust — brief GIL hold."""
        if self._loop is None:
            raise RuntimeError("AsyncTaskExecutor not started")
        asyncio.run_coroutine_threadsafe(
            self._execute(job_id, task_name, payload, retry_count, max_retries, queue_name),
            self._loop,
        )

    async def _execute(
        self,
        job_id: str,
        task_name: str,
        payload_bytes: bytes,
        retry_count: int,
        max_retries: int,
        queue_name: str,
    ) -> None:
        """Execute a single async task with full lifecycle support."""
        assert self._semaphore is not None
        async with self._semaphore:
            start_ns = time.monotonic_ns()
            token = set_async_context(job_id, task_name, retry_count, queue_name)
            release_callbacks: list[Any] = []
            proxy_cleanup: list[Any] = []
            result: Any = None
            error: Exception | None = None
            completed_mw: list[Any] = []

            try:
                args, kwargs = cloudpickle.loads(payload_bytes)
                queue = self._queue_ref

                # Reconstruct intercepted arguments
                redirects: dict[str, str] = {}
                if queue._interceptor is not None:
                    args, kwargs, redirects = reconstruct_args(args, kwargs)

                # Reconstruct proxy markers
                if queue._proxy_registry is not None and not queue._test_mode_active:
                    args, kwargs, proxy_cleanup = reconstruct_proxies(
                        args,
                        kwargs,
                        queue._proxy_registry,
                        signing_secret=queue._recipe_signing_key,
                        max_timeout=queue._max_reconstruction_timeout,
                        metrics=queue._proxy_metrics,
                    )

                # Inject resources
                runtime = queue._resource_runtime
                if runtime is not None:
                    for res_name in queue._task_inject_map.get(task_name, []):
                        if res_name not in kwargs:
                            instance, release = runtime.acquire_for_task(res_name)
                            kwargs[res_name] = instance
                            if release is not None:
                                release_callbacks.append(release)
                    for kwarg_name, resource_name in redirects.items():
                        instance, release = runtime.acquire_for_task(resource_name)
                        kwargs[kwarg_name] = instance
                        if release is not None:
                            release_callbacks.append(release)

                # Middleware before hooks
                middleware_chain = queue._get_middleware_chain(task_name)
                from taskito.context import current_job

                for mw in middleware_chain:
                    try:
                        mw.before(current_job)
                        completed_mw.append(mw)
                    except Exception:
                        logger.exception("middleware before() error")

                # Execute the async function
                wrapper = self._registry[task_name]
                fn = wrapper._taskito_async_fn
                result = await fn(*args, **kwargs)

                # Serialize and report success
                result_bytes = cloudpickle.dumps(result) if result is not None else None
                wall_ns = time.monotonic_ns() - start_ns
                self._sender.report_success(job_id, task_name, result_bytes, wall_ns)

            except TaskCancelledError:
                error = None  # Don't treat cancellation as an error for middleware
                wall_ns = time.monotonic_ns() - start_ns
                self._sender.report_cancelled(job_id, task_name, wall_ns)

            except Exception as exc:
                error = exc
                wall_ns = time.monotonic_ns() - start_ns
                error_msg = traceback.format_exc()
                should_retry = self._check_retry(task_name, exc)
                self._sender.report_failure(
                    job_id,
                    task_name,
                    error_msg,
                    retry_count,
                    max_retries,
                    wall_ns,
                    should_retry,
                )

            finally:
                # Release task/request-scoped resources
                for release_fn in release_callbacks:
                    try:
                        release_fn()
                    except Exception:
                        logger.exception("resource release error")

                # Clean up reconstructed proxies
                cleanup_proxies(proxy_cleanup, metrics=self._queue_ref._proxy_metrics)

                # Middleware after hooks (only those whose before() succeeded)
                from taskito.context import current_job

                for mw in completed_mw:
                    try:
                        mw.after(current_job, result, error)
                    except Exception:
                        logger.exception("middleware after() error")

                clear_async_context(token)

    def _check_retry(self, task_name: str, exc: Exception) -> bool:
        """Check retry filters to decide if this exception should be retried."""
        filters = self._queue_ref._task_retry_filters.get(task_name)
        if filters is None:
            return True

        dont_retry_on = filters.get("dont_retry_on", [])
        for cls in dont_retry_on:
            if isinstance(exc, cls):
                return False

        retry_on = filters.get("retry_on", [])
        if retry_on:
            return any(isinstance(exc, cls) for cls in retry_on)

        return True

    def stop(self) -> None:
        """Stop the executor's event loop and join the thread."""
        if self._loop is not None and self._loop.is_running():
            self._loop.call_soon_threadsafe(self._loop.stop)
        if self._thread is not None:
            self._thread.join(timeout=5)
            if self._thread.is_alive():
                logger.warning("Async executor thread did not stop within 5s timeout")
