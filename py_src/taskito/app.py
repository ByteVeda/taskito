"""Main Queue class and @task decorator."""

from __future__ import annotations

import asyncio
import contextlib
import functools
import logging
import os
import signal
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

import cloudpickle

from taskito._taskito import PyQueue, PyTaskConfig
from taskito.result import JobResult
from taskito.task import TaskWrapper

logger = logging.getLogger("taskito")


class Queue:
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
    ):
        """Initialize a new task queue backed by SQLite.

        Args:
            db_path: Path to the SQLite database file. Defaults to
                ``.taskito/taskito.db``. Parent directories are created
                automatically.
            workers: Number of worker threads (0 = auto-detect CPU count).
            default_retry: Default max retry attempts for tasks.
            default_timeout: Default task timeout in seconds.
            default_priority: Default task priority (higher = more urgent).
            result_ttl: Auto-cleanup completed/dead jobs older than this many
                seconds. None disables auto-cleanup.
        """
        # Ensure parent directory exists
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
        )
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

    def task(
        self,
        name: str | None = None,
        max_retries: int = 3,
        retry_backoff: float = 1.0,
        timeout: int = 300,
        priority: int = 0,
        rate_limit: str | None = None,
        queue: str = "default",
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

        Example::

            @queue.task(max_retries=5, rate_limit="100/m", queue="emails")
            def send_email(to: str, subject: str, body: str):
                ...

            send_email.delay("user@example.com", "Hello", "World")
        """

        def decorator(fn: Callable) -> TaskWrapper:
            task_name = name or f"{fn.__module__}.{fn.__qualname__}"

            # Wrap the function with hooks and context
            wrapped = self._wrap_task(fn, task_name)
            self._task_registry[task_name] = wrapped

            # Store config for worker startup
            config = PyTaskConfig(
                name=task_name,
                max_retries=max_retries,
                retry_backoff=retry_backoff,
                timeout=timeout,
                priority=priority,
                rate_limit=rate_limit,
                queue=queue,
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

        Example::

            @queue.periodic(cron="0 */5 * * * *")
            def cleanup():
                ...
        """

        def decorator(fn: Callable) -> TaskWrapper:
            # Register as a normal task first
            wrapper = self.task(name=name, queue=queue)(fn)

            # Store periodic config for registration at worker startup
            payload = cloudpickle.dumps((args, kwargs or {}))
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

        Example::

            @queue.before_task
            def log_start(task_name, args, kwargs):
                print(f"Starting {task_name}")
        """
        self._hooks["before_task"].append(fn)
        return fn

    def after_task(self, fn: Callable) -> Callable:
        """Register a hook called after each task completes or fails.

        Always called regardless of outcome, similar to a ``finally`` block.
        Runs after :meth:`on_success` or :meth:`on_failure`.

        Args:
            fn: Callback with signature
                ``fn(task_name, args, kwargs, result, error)``.
                *result* is the return value on success (``None`` on failure).
                *error* is the exception on failure (``None`` on success).

        Example::

            @queue.after_task
            def log_end(task_name, args, kwargs, result, error):
                status = "OK" if error is None else f"FAILED: {error}"
                print(f"Finished {task_name}: {status}")
        """
        self._hooks["after_task"].append(fn)
        return fn

    def on_success(self, fn: Callable) -> Callable:
        """Register a hook called when a task completes successfully.

        Args:
            fn: Callback with signature
                ``fn(task_name, args, kwargs, result)``.

        Example::

            @queue.on_success
            def track_success(task_name, args, kwargs, result):
                metrics.increment(f"task.{task_name}.success")
        """
        self._hooks["on_success"].append(fn)
        return fn

    def on_failure(self, fn: Callable) -> Callable:
        """Register a hook called when a task raises an exception.

        Called before the exception propagates to the retry/DLQ logic.

        Args:
            fn: Callback with signature
                ``fn(task_name, args, kwargs, error)``.

        Example::

            @queue.on_failure
            def alert(task_name, args, kwargs, error):
                slack.post(f"Task {task_name} failed: {error}")
        """
        self._hooks["on_failure"].append(fn)
        return fn

    def _wrap_task(self, fn: Callable, task_name: str) -> Callable:
        """Wrap a task function with hooks and job context."""
        from taskito.context import _clear_context

        hooks = self._hooks

        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            for hook in hooks["before_task"]:
                hook(task_name, args, kwargs)

            error = None
            result = None
            try:
                ret = fn(*args, **kwargs)
                if asyncio.iscoroutine(ret):
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
    ) -> JobResult:
        """Enqueue a task for background execution.

        This is the low-level enqueue method. For most use cases, prefer
        :meth:`TaskWrapper.delay` or :meth:`TaskWrapper.apply_async`.

        Args:
            task_name: Registered task name (e.g. ``"myapp.tasks.send_email"``).
            args: Positional arguments to pass to the task function.
            kwargs: Keyword arguments to pass to the task function.
            priority: Job priority (higher = more urgent). ``None`` uses
                the queue's ``default_priority``.
            delay: Delay in seconds before the job becomes eligible to run.
            queue: Target queue name. ``None`` uses ``"default"``.
            max_retries: Max retry attempts. ``None`` uses the queue's
                ``default_retry``.
            timeout: Timeout in seconds. ``None`` uses the queue's
                ``default_timeout``.
            unique_key: Deduplication key. If a pending or running job with
                the same key exists, returns that job instead of creating
                a new one.
            metadata: Arbitrary JSON string to attach to the job.
            depends_on: Job ID or list of job IDs that must complete
                before this job can run. If any dependency fails or is
                cancelled, this job is cascade-cancelled.

        Returns:
            A :class:`~taskito.result.JobResult` handle for the created
            (or deduplicated) job.

        Raises:
            ValueError: If *depends_on* references a non-existent job ID.
        """
        payload = cloudpickle.dumps((args, kwargs or {}))

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
        payloads = [cloudpickle.dumps((args, kw)) for args, kw in zip(args_list, kw_list)]
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
        """Retrieve a job by its unique ID.

        Args:
            job_id: The job's ULID string.

        Returns:
            A :class:`~taskito.result.JobResult` if found, or ``None``.
        """
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
        """List jobs with optional filters and pagination.

        Args:
            status: Filter by status ("pending", "running", "complete",
                "failed", "dead", "cancelled"). None returns all.
            queue: Filter by queue name. None returns all queues.
            task_name: Filter by task name. None returns all tasks.
            limit: Maximum number of jobs to return.
            offset: Number of jobs to skip (for pagination).

        Returns:
            List of JobResult handles, ordered by creation time (newest first).
        """
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
        """Get queue statistics as a dict of status counts.

        Returns:
            Dict with keys ``"pending"``, ``"running"``, ``"completed"``,
            ``"failed"``, ``"dead"``, ``"cancelled"`` mapped to integer counts.
        """
        return self._inner.stats()

    def dead_letters(self, limit: int = 10, offset: int = 0) -> list[dict]:
        """List dead letter queue entries (jobs that exhausted all retries).

        Args:
            limit: Maximum number of entries to return.
            offset: Number of entries to skip (for pagination).

        Returns:
            List of dicts, each containing ``"id"``, ``"task_name"``,
            ``"error"``, ``"failed_at"``, and the original job fields.
        """
        return self._inner.dead_letters(limit=limit, offset=offset)

    def retry_dead(self, dead_id: str) -> str:
        """Re-enqueue a dead letter job, creating a fresh job with the same payload.

        Args:
            dead_id: The dead letter entry ID (not the original job ID).

        Returns:
            The new job ID.

        Raises:
            ValueError: If *dead_id* does not exist.
        """
        return self._inner.retry_dead(dead_id)

    def purge_dead(self, older_than: int = 86400) -> int:
        """Delete dead letter entries older than a given age.

        Args:
            older_than: Age threshold in seconds. Entries older than this
                are deleted.

        Returns:
            Number of entries deleted.
        """
        return self._inner.purge_dead(older_than)

    def cancel_job(self, job_id: str) -> bool:
        """Cancel a pending job before it starts executing.

        Only jobs in ``"pending"`` status can be cancelled. Running or
        completed jobs are unaffected.

        Args:
            job_id: The job ID to cancel.

        Returns:
            ``True`` if the job was pending and is now cancelled,
            ``False`` otherwise.
        """
        return self._inner.cancel_job(job_id)

    def update_progress(self, job_id: str, progress: int) -> None:
        """Update the progress percentage for a running job.

        Typically called from within a task via
        :meth:`~taskito.context.JobContext.update_progress` rather than
        directly.

        Args:
            job_id: The job ID to update.
            progress: Progress value from 0 to 100.
        """
        self._inner.update_progress(job_id, progress)

    def job_errors(self, job_id: str) -> list[dict]:
        """Get the error history for a job (one entry per failed attempt).

        Args:
            job_id: The job ID to inspect.

        Returns:
            List of dicts, each containing ``"attempt"``, ``"error"``,
            and ``"failed_at"`` keys.
        """
        return self._inner.get_job_errors(job_id)

    def purge_completed(self, older_than: int = 86400) -> int:
        """Delete completed jobs older than a given age.

        Args:
            older_than: Age threshold in seconds. Completed jobs older
                than this are deleted.

        Returns:
            Number of jobs deleted.
        """
        return self._inner.purge_completed(older_than)

    # -- Async inspection methods --

    async def astats(self) -> dict[str, int]:
        """Async version of :meth:`stats`.

        Returns:
            Dict with keys ``"pending"``, ``"running"``, ``"completed"``,
            ``"failed"``, ``"dead"``, ``"cancelled"`` mapped to integer counts.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self._executor, self.stats)

    async def adead_letters(self, limit: int = 10, offset: int = 0) -> list[dict]:
        """Async version of :meth:`dead_letters`.

        Args:
            limit: Maximum number of entries to return.
            offset: Number of entries to skip (for pagination).

        Returns:
            List of dead letter entry dicts.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            self._executor, lambda: self.dead_letters(limit=limit, offset=offset)
        )

    async def aretry_dead(self, dead_id: str) -> str:
        """Async version of :meth:`retry_dead`.

        Args:
            dead_id: The dead letter entry ID.

        Returns:
            The new job ID.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self._executor, lambda: self.retry_dead(dead_id))

    async def acancel_job(self, job_id: str) -> bool:
        """Async version of :meth:`cancel_job`.

        Args:
            job_id: The job ID to cancel.

        Returns:
            ``True`` if cancelled, ``False`` otherwise.
        """
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self._executor, lambda: self.cancel_job(job_id))

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
        lines.append(f"> DB:          {self._db_path}")
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

    def run_worker(self, queues: Sequence[str] | None = None) -> None:
        """Start the worker loop. Blocks until interrupted.

        Dispatches jobs from the queue to Rust worker threads for execution.
        Call this in a separate process or thread from your main application.

        On the main thread, installs a SIGINT handler for graceful shutdown:
        the first ``Ctrl+C`` finishes in-flight jobs, the second force-kills.

        Args:
            queues: List of queue names to consume from. ``None`` consumes
                from all queues.

        Note:
            Periodic tasks registered via :meth:`periodic` are activated
            when the worker starts, not at registration time.
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

        # Set up signal handler for graceful shutdown (only in main thread)
        import threading

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
            logger.info("Worker stopped.")
            if is_main and original_sigint is not None:
                signal.signal(signal.SIGINT, original_sigint)

    async def arun_worker(self, queues: Sequence[str] | None = None) -> None:
        """Async version of :meth:`run_worker`.

        Runs the blocking worker loop in a thread executor so it does not
        block the asyncio event loop.

        Args:
            queues: List of queue names to consume from. ``None`` consumes
                from all queues.
        """
        loop = asyncio.get_event_loop()

        # Install SIGINT handler on the event loop so Ctrl+C triggers
        # graceful shutdown instead of crashing the asyncio runner.
        original_handler = signal.getsignal(signal.SIGINT)

        def _shutdown_once() -> None:
            logger.info("Shutting down gracefully (waiting for in-flight jobs)...")
            self._inner.request_shutdown()
            # Restore original handler so a second Ctrl+C force-kills
            loop.remove_signal_handler(signal.SIGINT)
            signal.signal(signal.SIGINT, original_handler)

        loop.add_signal_handler(signal.SIGINT, _shutdown_once)

        try:
            await loop.run_in_executor(None, lambda: self.run_worker(queues=queues))
        finally:
            with contextlib.suppress(NotImplementedError):
                loop.remove_signal_handler(signal.SIGINT)
            signal.signal(signal.SIGINT, original_handler)
