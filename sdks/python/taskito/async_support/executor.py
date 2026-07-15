"""AsyncTaskExecutor — dedicated event loop for native async task execution."""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from taskito.async_support.context import clear_async_context, set_async_context
from taskito.context import current_job
from taskito.events import EventType
from taskito.exceptions import TaskCancelledError
from taskito.interception.reconstruct import reconstruct_args
from taskito.proxies import cleanup_proxies, reconstruct_proxies
from taskito.task_errors import encode_task_error

if TYPE_CHECKING:
    from taskito.app import Queue

logger = logging.getLogger("taskito.async")

# Backoff bounds for handing a result to Rust while the result channel is full.
_REPORT_BACKOFF_START_S = 0.001
_REPORT_BACKOFF_MAX_S = 0.05


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
        permit: Any = None,
    ) -> None:
        """Submit an async job for execution. Called from Rust — brief GIL hold.

        ``permit`` is the dispatch slot the pool acquired for this job; holding it on
        the coroutine frame is what releases it on every exit path. It is optional so
        the executor can also be driven directly, without a pool.
        """
        if self._loop is None:
            raise RuntimeError("AsyncTaskExecutor not started")
        asyncio.run_coroutine_threadsafe(
            self._execute(
                job_id, task_name, payload, retry_count, max_retries, queue_name, permit
            ),
            self._loop,
        )

    async def _hand_off(self, send: Callable[[], bool]) -> None:
        """Push a result to Rust, backing off while the result channel is full.

        Never drops a result — a dropped one strands the job ``Running`` until the
        reaper mislabels it a timeout. Awaiting between attempts is what keeps the
        event loop responsive: a blocking send would freeze every other coroutine on
        this thread, and would deadlock against the drain loop, which re-acquires the
        GIL each iteration and so could never drain the channel being waited on.
        """
        delay = _REPORT_BACKOFF_START_S
        while not send():
            await asyncio.sleep(delay)
            delay = min(delay * 2, _REPORT_BACKOFF_MAX_S)

    def _hand_off_now(self, send: Callable[[], bool], job_id: str) -> None:
        """Single best-effort hand-off for a coroutine already being torn down.

        The cancellation path cannot use :meth:`_hand_off`: awaiting inside a
        ``CancelledError`` handler risks being cancelled again on a loop that may be
        stopping. The channel is drained continuously, so a full one is rare here; the
        stale-job reaper remains the backstop if this does drop.
        """
        if not send():
            logger.warning("result channel full while cancelling %s; job left to reaper", job_id)

    async def _execute(
        self,
        job_id: str,
        task_name: str,
        payload_bytes: bytes,
        retry_count: int,
        max_retries: int,
        queue_name: str,
        permit: Any = None,
    ) -> None:
        """Execute a single async task with full lifecycle support."""
        assert self._semaphore is not None
        try:
            await self._run_job(
                job_id, task_name, payload_bytes, retry_count, max_retries, queue_name
            )
        finally:
            # Hand the dispatch slot back as soon as the job is done rather than
            # waiting for the frame to be collected. Dropping the handle is the
            # backstop for paths that never reach here.
            if permit is not None:
                permit.release()

    async def _run_job(
        self,
        job_id: str,
        task_name: str,
        payload_bytes: bytes,
        retry_count: int,
        max_retries: int,
        queue_name: str,
    ) -> None:
        """Run one job: gate on the concurrency backstop, execute, report."""
        assert self._semaphore is not None
        async with self._semaphore:
            start_ns = time.monotonic_ns()
            token = set_async_context(job_id, task_name, retry_count, queue_name)
            release_callbacks: list[Any] = []
            proxy_cleanup: list[Any] = []
            result: Any = None
            error: Exception | None = None
            completed_mw: list[Any] = []
            # Set before the hand-off so a raising send can't also fire report_failure
            # for the same job — the scheduler would then see two results for one job.
            reported = False
            # Cancellation has its own event, emitted by the Rust outcome loop.
            cancelled = False

            try:
                queue = self._queue_ref
                # Honor the per-task serializer (matches the sync worker path);
                # a hardcoded cloudpickle.loads would ignore @task(serializer=...).
                args, kwargs = queue._deserialize_payload(task_name, payload_bytes)

                # Worker-dispatch predicate gate (raw args, pre-reconstruction).
                if task_name in queue._task_predicates:
                    queue._apply_dispatch_predicate(
                        task_name=task_name,
                        args=args,
                        kwargs=kwargs,
                        job_id=job_id,
                        queue_name=queue_name,
                        retry_count=retry_count,
                    )

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

                # Middleware before hooks (skipping filtered middlewares)
                middleware_chain = queue._get_middleware_chain(task_name)
                for mw in middleware_chain:
                    if not mw._should_apply(current_job):
                        continue
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
                result_bytes = (
                    queue._serialize_result(task_name, result) if result is not None else None
                )
                wall_ns = time.monotonic_ns() - start_ns
                reported = True
                await self._hand_off(
                    lambda: self._sender.try_report_success(
                        job_id, task_name, result_bytes, wall_ns
                    )
                )

            except TaskCancelledError:
                error = None  # Don't treat cancellation as an error for middleware
                cancelled = True
                if not reported:
                    wall_ns = time.monotonic_ns() - start_ns
                    reported = True
                    await self._hand_off(
                        lambda: self._sender.try_report_cancelled(job_id, task_name, wall_ns)
                    )

            except asyncio.CancelledError:
                # CancelledError is a BaseException, so `except Exception` misses it and
                # the job would sit Running until the reaper mislabelled it a timeout.
                # Report, then re-raise — swallowing a cancellation breaks loop shutdown.
                cancelled = True
                if not reported:
                    wall_ns = time.monotonic_ns() - start_ns
                    reported = True
                    self._hand_off_now(
                        lambda: self._sender.try_report_cancelled(job_id, task_name, wall_ns),
                        job_id,
                    )
                raise

            except Exception as exc:
                error = exc
                if not reported:
                    wall_ns = time.monotonic_ns() - start_ns
                    reported = True
                    error_msg = encode_task_error(exc)
                    should_retry = self._check_retry(task_name, exc)
                    await self._hand_off(
                        lambda: self._sender.try_report_failure(
                            job_id,
                            task_name,
                            error_msg,
                            retry_count,
                            max_retries,
                            wall_ns,
                            should_retry,
                        )
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
                for mw in completed_mw:
                    try:
                        mw.after(current_job, result, error)
                    except Exception:
                        logger.exception("middleware after() error")

                # Emit job lifecycle events. The Rust outcome loop deliberately
                # skips Success — the blocking wrapper emits it — and native
                # dispatch bypasses that wrapper, so it has to emit here too or
                # nothing downstream (workflow tracker, subscribers) ever learns
                # the job finished. Cancellation is the exception — that outcome
                # does have a Rust-side event.
                if not cancelled:
                    self._emit_lifecycle_event(job_id, task_name, queue_name, error)

                clear_async_context(token)

    def _emit_lifecycle_event(
        self, job_id: str, task_name: str, queue_name: str, error: Exception | None
    ) -> None:
        """Emit JOB_COMPLETED/JOB_FAILED, mirroring the blocking task wrapper."""
        payload: dict[str, Any] = {
            "task_name": task_name,
            "job_id": job_id,
            "queue": queue_name,
        }
        if error is not None:
            payload["error"] = str(error)
        try:
            self._queue_ref._emit_event(
                EventType.JOB_FAILED if error is not None else EventType.JOB_COMPLETED,
                payload,
            )
        except Exception:
            logger.exception("job lifecycle event error")

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
