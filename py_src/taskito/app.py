"""Main Queue class and @task decorator."""

from __future__ import annotations

import asyncio
import contextlib
import functools
import logging
import os
import signal
import threading
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    from taskito.testing import TestMode

from taskito._taskito import PyQueue, PyTaskConfig
from taskito.middleware import TaskMiddleware
from taskito.mixins import (
    QueueCircuitBreakersMixin,
    QueueDeadLettersMixin,
    QueueLogsMixin,
    QueueMetricsMixin,
    QueueReplayMixin,
    QueueWorkersMixin,
)
from taskito.result import JobResult
from taskito.serializers import CloudpickleSerializer, Serializer
from taskito.task import TaskWrapper

logger = logging.getLogger("taskito")


class Queue(
    QueueMetricsMixin,
    QueueDeadLettersMixin,
    QueueReplayMixin,
    QueueCircuitBreakersMixin,
    QueueLogsMixin,
    QueueWorkersMixin,
):
    """
    Rust-powered task queue with embedded SQLite storage.

    Usage::

        queue = Queue()

        @queue.task()
        def send_email(to, subject, body):
            ...

        job = send_email.delay("user@example.com", "Hello", "World")
        queue.run_worker()  # in another process/thread
    """

    def __init__(
        self,
        db_path: str = ".taskito/taskito.db",
        workers: int = 0,
        default_retry: int = 3,
        default_timeout: int = 300,
        default_priority: int = 0,
        result_ttl: int | None = None,
        serializer: Serializer | None = None,
        middleware: list[TaskMiddleware] | None = None,
        backend: str = "sqlite",
        db_url: str | None = None,
        schema: str = "taskito",
    ):
        """Initialize a new task queue.

        Args:
            db_path: Path to the SQLite database file. Defaults to
                ``.taskito/taskito.db``. Parent directories are created
                automatically. Ignored when backend is ``"postgres"``.
            workers: Number of worker threads (0 = auto-detect CPU count).
            default_retry: Default max retry attempts for tasks.
            default_timeout: Default task timeout in seconds.
            default_priority: Default task priority (higher = more urgent).
            result_ttl: Auto-cleanup completed/dead jobs older than this many
                seconds. None disables auto-cleanup.
            serializer: Serializer for task payloads. Defaults to CloudpickleSerializer.
            middleware: List of global middleware instances applied to all tasks.
            backend: Storage backend — ``"sqlite"`` (default) or ``"postgres"``.
            db_url: PostgreSQL connection URL (required when backend is ``"postgres"``).
                Example: ``"postgresql://user:pass@localhost/taskito"``.
            schema: PostgreSQL schema name for all taskito tables. Defaults to
                ``"taskito"``. Ignored when backend is ``"sqlite"``.
        """
        if backend == "sqlite":
            # Ensure parent directory exists for SQLite
            db_dir = os.path.dirname(db_path)
            if db_dir:
                os.makedirs(db_dir, exist_ok=True)

        self._inner = PyQueue(
            db_path=db_path,
            workers=workers,
            default_retry=default_retry,
            default_timeout=default_timeout,
            default_priority=default_priority,
            result_ttl=result_ttl,
            backend=backend,
            db_url=db_url,
            schema=schema,
        )
        self._backend = backend
        self._db_url = db_url
        self._schema = schema
        self._db_path = db_path
        self._workers = workers or os.cpu_count() or 1
        self._task_registry: dict[str, Callable] = {}
        self._task_configs: list[PyTaskConfig] = []
        self._executor = ThreadPoolExecutor(max_workers=2)
        self._periodic_configs: list[dict[str, Any]] = []
        self._hooks: dict[str, list[Callable]] = {
            "before_task": [],
            "after_task": [],
            "on_success": [],
            "on_failure": [],
        }
        self._serializer: Serializer = serializer or CloudpickleSerializer()
        self._global_middleware: list[TaskMiddleware] = middleware or []
        self._task_middleware: dict[str, list[TaskMiddleware]] = {}
        self._task_retry_filters: dict[str, dict[str, list[type[Exception]]]] = {}

    def task(
        self,
        name: str | None = None,
        max_retries: int = 3,
        retry_backoff: float = 1.0,
        timeout: int = 300,
        priority: int = 0,
        rate_limit: str | None = None,
        queue: str = "default",
        circuit_breaker: dict | None = None,
        retry_on: list[type[Exception]] | None = None,
        dont_retry_on: list[type[Exception]] | None = None,
        soft_timeout: float | None = None,
        middleware: list[TaskMiddleware] | None = None,
    ) -> Callable[[Callable[..., Any]], TaskWrapper]:
        """Decorator to register a function as a background task.

        Args:
            name: Explicit task name. Defaults to ``module.qualname``.
            max_retries: Max retry attempts on failure before moving to DLQ.
            retry_backoff: Base delay in seconds for exponential backoff between retries.
            timeout: Max execution time in seconds before the task is killed.
            priority: Priority level (higher = more urgent).
            rate_limit: Rate limit string, e.g. ``"100/m"``, ``"10/s"``, ``"3600/h"``.
            queue: Named queue to submit to.
            circuit_breaker: Optional dict with ``threshold``, ``window`` (seconds),
                and ``cooldown`` (seconds) keys.
            retry_on: List of exception classes that should trigger retries.
                If set, only these exceptions are retried.
            dont_retry_on: List of exception classes that should never be retried.
            soft_timeout: Soft timeout in seconds. Checked via ``current_job.check_timeout()``.
            middleware: Per-task middleware instances (in addition to global middleware).
        """

        def decorator(fn: Callable) -> TaskWrapper:
            task_name = name or f"{fn.__module__}.{fn.__qualname__}"

            # Store retry filters
            if retry_on or dont_retry_on:
                self._task_retry_filters[task_name] = {
                    "retry_on": retry_on or [],
                    "dont_retry_on": dont_retry_on or [],
                }

            # Store per-task middleware
            if middleware:
                self._task_middleware[task_name] = middleware

            # Wrap the function with hooks, middleware, and context
            wrapped = self._wrap_task(fn, task_name, soft_timeout)
            self._task_registry[task_name] = wrapped

            cb_threshold = None
            cb_window = None
            cb_cooldown = None
            if circuit_breaker:
                cb_threshold = circuit_breaker.get("threshold", 5)
                cb_window = circuit_breaker.get("window", 60)
                cb_cooldown = circuit_breaker.get("cooldown", 300)

            # Store config for worker startup
            config = PyTaskConfig(
                name=task_name,
                max_retries=max_retries,
                retry_backoff=retry_backoff,
                timeout=timeout,
                priority=priority,
                rate_limit=rate_limit,
                queue=queue,
                circuit_breaker_threshold=cb_threshold,
                circuit_breaker_window=cb_window,
                circuit_breaker_cooldown=cb_cooldown,
            )
            self._task_configs.append(config)

            # Return a TaskWrapper that has .delay() and .apply_async()
            wrapper = TaskWrapper(
                fn=fn,
                queue_ref=self,
                task_name=task_name,
                default_priority=priority,
                default_queue=queue,
                default_max_retries=max_retries,
                default_timeout=timeout,
            )

            # Preserve function metadata
            functools.update_wrapper(wrapper, fn)

            return wrapper

        return decorator

    def periodic(
        self,
        cron: str,
        name: str | None = None,
        args: tuple = (),
        kwargs: dict | None = None,
        queue: str = "default",
    ) -> Callable[[Callable[..., Any]], TaskWrapper]:
        """Decorator to register a periodic (cron-scheduled) task.

        Args:
            cron: Cron expression (6-field with seconds), e.g. ``"0 */5 * * * *"``
                for every 5 minutes.
            name: Explicit task name. Defaults to ``module.qualname``.
            args: Positional arguments to pass to the task on each run.
            kwargs: Keyword arguments to pass to the task on each run.
            queue: Named queue to submit to.
        """

        def decorator(fn: Callable) -> TaskWrapper:
            # Register as a normal task first
            wrapper = self.task(name=name, queue=queue)(fn)

            # Store periodic config for registration at worker startup
            payload = self._serializer.dumps((args, kwargs or {}))
            self._periodic_configs.append(
                {
                    "name": name or f"{fn.__module__}.{fn.__qualname__}",
                    "task_name": wrapper.name,
                    "cron_expr": cron,
                    "payload": payload,
                    "queue": queue,
                }
            )

            return wrapper

        return decorator

    # -- Hooks / middleware --

    def before_task(self, fn: Callable) -> Callable:
        """Register a hook called before each task executes.

        Args:
            fn: Callback with signature ``fn(task_name, args, kwargs)``.
        """
        self._hooks["before_task"].append(fn)
        return fn

    def after_task(self, fn: Callable) -> Callable:
        """Register a hook called after each task completes or fails.

        Args:
            fn: Callback with signature
                ``fn(task_name, args, kwargs, result, error)``.
        """
        self._hooks["after_task"].append(fn)
        return fn

    def on_success(self, fn: Callable) -> Callable:
        """Register a hook called when a task completes successfully.

        Args:
            fn: Callback with signature
                ``fn(task_name, args, kwargs, result)``.
        """
        self._hooks["on_success"].append(fn)
        return fn

    def on_failure(self, fn: Callable) -> Callable:
        """Register a hook called when a task raises an exception.

        Args:
            fn: Callback with signature
                ``fn(task_name, args, kwargs, error)``.
        """
        self._hooks["on_failure"].append(fn)
        return fn

    def _get_middleware_chain(self, task_name: str) -> list[TaskMiddleware]:
        """Get the combined global + per-task middleware list."""
        per_task = self._task_middleware.get(task_name, [])
        return self._global_middleware + per_task

    def _wrap_task(
        self, fn: Callable, task_name: str, soft_timeout: float | None = None
    ) -> Callable:
        """Wrap a task function with hooks, middleware, and job context."""
        from taskito.context import _clear_context, current_job

        hooks = self._hooks
        queue_ref = self

        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            middleware_chain = queue_ref._get_middleware_chain(task_name)

            # Set soft timeout on context if configured
            if soft_timeout is not None:
                current_job._set_soft_timeout(soft_timeout)

            # Run middleware before hooks
            for mw in middleware_chain:
                try:
                    mw.before(current_job)
                except Exception:
                    logger.exception("middleware before() error")

            for hook in hooks["before_task"]:
                hook(task_name, args, kwargs)

            error = None
            result = None
            try:
                ret = fn(*args, **kwargs)
                if asyncio.iscoroutine(ret):
                    loop = getattr(queue_ref, "_async_loop", None)
                    if loop is not None and loop.is_running():
                        future = asyncio.run_coroutine_threadsafe(ret, loop)
                        ret = future.result()
                    else:
                        ret = asyncio.run(ret)
                result = ret
            except Exception as exc:
                error = exc
                for hook in hooks["on_failure"]:
                    hook(task_name, args, kwargs, exc)
                raise
            else:
                for hook in hooks["on_success"]:
                    hook(task_name, args, kwargs, result)
                return result
            finally:
                for hook in hooks["after_task"]:
                    hook(task_name, args, kwargs, result, error)
                # Run middleware after hooks
                for mw in middleware_chain:
                    try:
                        mw.after(current_job, result, error)
                    except Exception:
                        logger.exception("middleware after() error")
                _clear_context()

        return wrapper

    def enqueue(
        self,
        task_name: str,
        args: tuple = (),
        kwargs: dict | None = None,
        priority: int | None = None,
        delay: float | None = None,
        queue: str | None = None,
        max_retries: int | None = None,
        timeout: int | None = None,
        unique_key: str | None = None,
        metadata: str | None = None,
        depends_on: str | list[str] | None = None,
        expires: float | None = None,
        result_ttl: int | None = None,
    ) -> JobResult:
        """Enqueue a task for background execution.

        Args:
            task_name: Registered task name.
            args: Positional arguments to pass to the task function.
            kwargs: Keyword arguments to pass to the task function.
            priority: Job priority (higher = more urgent).
            delay: Delay in seconds before the job becomes eligible to run.
            queue: Target queue name.
            max_retries: Max retry attempts.
            timeout: Timeout in seconds.
            unique_key: Deduplication key.
            metadata: Arbitrary JSON string to attach to the job.
            depends_on: Job ID or list of job IDs that must complete first.
            expires: Seconds until the job expires (skipped if not started by then).
            result_ttl: Per-job result TTL in seconds. Overrides global result_ttl.
        """
        payload = self._serializer.dumps((args, kwargs or {}))

        dep_ids = None
        if depends_on is not None:
            dep_ids = [depends_on] if isinstance(depends_on, str) else list(depends_on)

        py_job = self._inner.enqueue(
            task_name=task_name,
            payload=payload,
            queue=queue or "default",
            priority=priority,
            delay_seconds=delay,
            max_retries=max_retries,
            timeout=timeout,
            unique_key=unique_key,
            metadata=metadata,
            depends_on=dep_ids,
            expires=expires,
            result_ttl=result_ttl,
        )

        return JobResult(py_job=py_job, queue=self)

    def enqueue_many(
        self,
        task_name: str,
        args_list: list[tuple],
        kwargs_list: list[dict] | None = None,
        priority: int | None = None,
        queue: str | None = None,
        max_retries: int | None = None,
        timeout: int | None = None,
    ) -> list[JobResult]:
        """Enqueue multiple jobs for the same task in a single transaction.

        Args:
            task_name: The registered task name.
            args_list: List of positional argument tuples, one per job.
            kwargs_list: Optional list of kwarg dicts, one per job.
            priority: Priority for all jobs (uses default if None).
            queue: Queue name for all jobs (uses "default" if None).
            max_retries: Max retries for all jobs (uses default if None).
            timeout: Timeout in seconds for all jobs (uses default if None).

        Returns:
            List of JobResult handles, one per enqueued job.
        """
        count = len(args_list)
        kw_list = kwargs_list or [{}] * count
        payloads = [self._serializer.dumps((a, kw)) for a, kw in zip(args_list, kw_list)]
        task_names = [task_name] * count

        queues_list = [queue or "default"] * count if queue else None
        priorities_list = [priority] * count if priority is not None else None
        retries_list = [max_retries] * count if max_retries is not None else None
        timeouts_list = [timeout] * count if timeout is not None else None

        py_jobs = self._inner.enqueue_batch(
            task_names=task_names,
            payloads=payloads,
            queues=queues_list,
            priorities=priorities_list,
            max_retries_list=retries_list,
            timeouts=timeouts_list,
        )

        return [JobResult(py_job=pj, queue=self) for pj in py_jobs]

    def get_job(self, job_id: str) -> JobResult | None:
        """Retrieve a job by its unique ID."""
        py_job = self._inner.get_job(job_id)
        if py_job is None:
            return None
        return JobResult(py_job=py_job, queue=self)

    def list_jobs(
        self,
        status: str | None = None,
        queue: str | None = None,
        task_name: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[JobResult]:
        """List jobs with optional filters and pagination."""
        py_jobs = self._inner.list_jobs(
            status=status,
            queue=queue,
            task_name=task_name,
            limit=limit,
            offset=offset,
        )
        return [JobResult(py_job=pj, queue=self) for pj in py_jobs]

    # -- Sync inspection methods --

    def stats(self) -> dict[str, int]:
        """Get queue statistics as a dict of status counts."""
        return self._inner.stats()  # type: ignore[no-any-return]

    def cancel_job(self, job_id: str) -> bool:
        """Cancel a pending job before it starts executing."""
        return self._inner.cancel_job(job_id)  # type: ignore[no-any-return]

    def cancel_running_job(self, job_id: str) -> bool:
        """Request cancellation of a running job.

        The task must call ``current_job.check_cancelled()`` to observe
        the cancellation. Returns True if the cancel was requested.
        """
        return self._inner.request_cancel(job_id)  # type: ignore[no-any-return]

    def update_progress(self, job_id: str, progress: int) -> None:
        """Update the progress percentage for a running job."""
        self._inner.update_progress(job_id, progress)

    def job_errors(self, job_id: str) -> list[dict]:
        """Get the error history for a job."""
        return self._inner.get_job_errors(job_id)  # type: ignore[no-any-return]

    def purge_completed(self, older_than: int = 86400) -> int:
        """Delete completed jobs older than a given age."""
        return self._inner.purge_completed(older_than)  # type: ignore[no-any-return]

    # -- Async inspection methods --

    async def astats(self) -> dict[str, int]:
        """Async version of :meth:`stats`."""
        return await self._run_sync(self.stats)  # type: ignore[no-any-return]

    async def acancel_job(self, job_id: str) -> bool:
        """Async version of :meth:`cancel_job`."""
        return await self._run_sync(self.cancel_job, job_id)  # type: ignore[no-any-return]

    # -- Worker startup --

    def _print_banner(self, queues: list[str]) -> None:
        """Print a Celery-style ASCII startup banner."""
        from taskito import __version__

        banner = rf"""
 _            _    _ _
| |_ __ _ ___| | _(_) |_ ___
| __/ _` / __| |/ / | __/ _ \
| || (_| \__ \   <| | || (_) |
 \__\__,_|___/_|\_\_|\__\___/  v{__version__}
"""
        lines = [banner]
        lines.append(f"> Backend:     {self._backend}")
        if self._backend == "sqlite":
            lines.append(f"> DB:          {self._db_path}")
        else:
            # Mask password in connection URL for display
            url = self._db_url or ""
            if "@" in url:
                pre, post = url.split("@", 1)
                if ":" in pre:
                    scheme_user = pre.rsplit(":", 1)[0]
                    url = f"{scheme_user}:****@{post}"
            lines.append(f"> DB:          {url}")
            lines.append(f"> Schema:      {self._schema}")
        lines.append(f"> Concurrency: {self._workers} (threads)")
        lines.append(f"> Queues:      {', '.join(queues)}")
        lines.append("")

        task_names = sorted(self._task_registry.keys())
        if task_names:
            lines.append("[tasks]")
            for name in task_names:
                lines.append(f"  . {name}")
            lines.append("")

        if self._periodic_configs:
            lines.append("[periodic]")
            for pc in self._periodic_configs:
                lines.append(f"  . {pc['name']}  ({pc['cron_expr']})")
            lines.append("")

        print("\n".join(lines))

    def _start_async_loop(self) -> None:
        """Start a shared event loop in a background thread for async tasks."""
        self._async_loop = asyncio.new_event_loop()
        self._async_thread = threading.Thread(
            target=self._async_loop.run_forever,
            daemon=True,
            name="taskito-async-loop",
        )
        self._async_thread.start()

    def _stop_async_loop(self) -> None:
        """Stop the shared async event loop."""
        loop = getattr(self, "_async_loop", None)
        if loop is not None and loop.is_running():
            loop.call_soon_threadsafe(loop.stop)
            self._async_thread.join(timeout=5)

    def run_worker(self, queues: Sequence[str] | None = None) -> None:
        """Start the worker loop. Blocks until interrupted.

        Args:
            queues: List of queue names to consume from. ``None`` consumes
                from all queues.
        """
        queue_list = list(queues) if queues else None

        # Make queue accessible from job context (for current_job.update_progress())
        from taskito.context import _set_queue_ref

        _set_queue_ref(self)

        # Register periodic tasks with Rust scheduler
        for pc in self._periodic_configs:
            self._inner.register_periodic(
                name=pc["name"],
                task_name=pc["task_name"],
                cron_expr=pc["cron_expr"],
                args=pc["payload"],
                queue=pc["queue"],
            )

        worker_queues = queue_list or ["default"]
        self._print_banner(worker_queues)

        # Start shared async event loop for async tasks
        self._start_async_loop()

        # Set up signal handler for graceful shutdown (only in main thread)
        is_main = threading.current_thread() is threading.main_thread()
        original_sigint = None

        if is_main:
            original_sigint = signal.getsignal(signal.SIGINT)

            def shutdown_handler(signum: int, frame: Any) -> None:
                logger.info("Shutting down gracefully (waiting for in-flight jobs)...")
                self._inner.request_shutdown()
                # Restore original handler so a second Ctrl+C force-kills
                signal.signal(signal.SIGINT, original_sigint)

            signal.signal(signal.SIGINT, shutdown_handler)

        try:
            self._inner.run_worker(
                task_registry=self._task_registry,
                task_configs=self._task_configs,
                queues=queue_list,
            )
        except KeyboardInterrupt:
            logger.info("Worker force-stopped.")
        finally:
            self._stop_async_loop()
            logger.info("Worker stopped.")
            if is_main and original_sigint is not None:
                signal.signal(signal.SIGINT, original_sigint)

    # -- Test Mode --

    def test_mode(self, propagate_errors: bool = False) -> TestMode:
        """Return a context manager that runs tasks synchronously (no worker needed).

        Args:
            propagate_errors: If True, re-raise task exceptions immediately.

        Returns:
            A :class:`~taskito.testing.TestMode` context manager.
        """
        from taskito.testing import TestMode

        return TestMode(self, propagate_errors=propagate_errors)

    async def arun_worker(self, queues: Sequence[str] | None = None) -> None:
        """Async version of :meth:`run_worker`.

        Runs the blocking worker loop in a thread executor so it does not
        block the asyncio event loop.

        Args:
            queues: List of queue names to consume from.
        """
        loop = asyncio.get_event_loop()

        original_handler = signal.getsignal(signal.SIGINT)

        def _shutdown_once() -> None:
            logger.info("Shutting down gracefully (waiting for in-flight jobs)...")
            self._inner.request_shutdown()
            loop.remove_signal_handler(signal.SIGINT)
            signal.signal(signal.SIGINT, original_handler)

        loop.add_signal_handler(signal.SIGINT, _shutdown_once)

        try:
            await loop.run_in_executor(None, lambda: self.run_worker(queues=queues))
        finally:
            with contextlib.suppress(NotImplementedError):
                loop.remove_signal_handler(signal.SIGINT)
            signal.signal(signal.SIGINT, original_handler)
