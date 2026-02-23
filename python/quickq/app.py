"""Main Queue class and @task decorator."""

from __future__ import annotations

import asyncio
import functools
import signal
from collections.abc import Sequence
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

import cloudpickle

from quickq._quickq import PyQueue, PyTaskConfig
from quickq.result import JobResult
from quickq.task import TaskWrapper


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
        db_path: str = "quickq.db",
        workers: int = 0,
        default_retry: int = 3,
        default_timeout: int = 300,
        default_priority: int = 0,
    ):
        """Initialize a new task queue backed by SQLite.

        Args:
            db_path: Path to the SQLite database file.
            workers: Number of worker threads (0 = auto-detect CPU count).
            default_retry: Default max retry attempts for tasks.
            default_timeout: Default task timeout in seconds.
            default_priority: Default task priority (higher = more urgent).
        """
        self._inner = PyQueue(
            db_path=db_path,
            workers=workers,
            default_retry=default_retry,
            default_timeout=default_timeout,
            default_priority=default_priority,
        )
        self._task_registry: dict[str, Callable] = {}
        self._task_configs: list[PyTaskConfig] = []
        self._executor = ThreadPoolExecutor(max_workers=2)

    def task(
        self,
        name: str | None = None,
        max_retries: int = 3,
        retry_backoff: float = 1.0,
        timeout: int = 300,
        priority: int = 0,
        rate_limit: str | None = None,
        queue: str = "default",
    ) -> Callable:
        """Decorator to register a function as a task."""

        def decorator(fn: Callable) -> TaskWrapper:
            task_name = name or f"{fn.__module__}.{fn.__qualname__}"

            # Register in the task registry
            self._task_registry[task_name] = fn

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
    ) -> JobResult:
        """Enqueue a task for execution."""
        payload = cloudpickle.dumps((args, kwargs or {}))

        py_job = self._inner.enqueue(
            task_name=task_name,
            payload=payload,
            queue=queue or "default",
            priority=priority,
            delay_seconds=delay,
            max_retries=max_retries,
            timeout=timeout,
        )

        return JobResult(py_job=py_job, queue=self)

    def get_job(self, job_id: str) -> JobResult | None:
        """Get a job by ID."""
        py_job = self._inner.get_job(job_id)
        if py_job is None:
            return None
        return JobResult(py_job=py_job, queue=self)

    # -- Sync inspection methods --

    def stats(self) -> dict[str, int]:
        """Get queue statistics."""
        return self._inner.stats()

    def dead_letters(self, limit: int = 10, offset: int = 0) -> list[dict]:
        """List dead letter queue entries."""
        return self._inner.dead_letters(limit=limit, offset=offset)

    def retry_dead(self, dead_id: str) -> str:
        """Re-enqueue a dead letter job. Returns new job ID."""
        return self._inner.retry_dead(dead_id)

    def purge_dead(self, older_than: int = 86400) -> int:
        """Purge dead letter entries older than N seconds ago."""
        return self._inner.purge_dead(older_than)

    # -- Async inspection methods --

    async def astats(self) -> dict[str, int]:
        """Async version of stats()."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self._executor, self.stats)

    async def adead_letters(self, limit: int = 10, offset: int = 0) -> list[dict]:
        """Async version of dead_letters()."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            self._executor, lambda: self.dead_letters(limit=limit, offset=offset)
        )

    async def aretry_dead(self, dead_id: str) -> str:
        """Async version of retry_dead()."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(self._executor, lambda: self.retry_dead(dead_id))

    # -- Worker startup --

    def run_worker(self, queues: Sequence[str] | None = None) -> None:
        """
        Start the worker loop. Blocks until interrupted (Ctrl+C).
        Call this in a separate process or thread.
        """
        queue_list = list(queues) if queues else None

        # Print startup info
        num_tasks = len(self._task_registry)
        worker_queues = queue_list or ["default"]
        print("[quickq] Starting worker...")
        print(f"[quickq] Registered tasks: {num_tasks}")
        print(f"[quickq] Queues: {', '.join(worker_queues)}")

        # Set up signal handler for graceful shutdown (only in main thread)
        import threading

        is_main = threading.current_thread() is threading.main_thread()
        original_sigint = None

        if is_main:
            original_sigint = signal.getsignal(signal.SIGINT)

            def shutdown_handler(signum: int, frame: Any) -> None:
                print("\n[quickq] Shutting down gracefully...")
                signal.signal(signal.SIGINT, original_sigint)
                raise KeyboardInterrupt

            signal.signal(signal.SIGINT, shutdown_handler)

        try:
            self._inner.run_worker(
                task_registry=self._task_registry,
                task_configs=self._task_configs,
                queues=queue_list,
            )
        except KeyboardInterrupt:
            print("[quickq] Worker stopped.")
        finally:
            if is_main and original_sigint is not None:
                signal.signal(signal.SIGINT, original_sigint)

    async def arun_worker(self, queues: Sequence[str] | None = None) -> None:
        """
        Async version of run_worker(). Runs the worker in a thread pool
        so it doesn't block the event loop.
        """
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: self.run_worker(queues=queues))
