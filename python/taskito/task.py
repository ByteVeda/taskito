"""Task wrapper providing .delay() and .apply_async() methods."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    from taskito.app import Queue
    from taskito.canvas import Signature
    from taskito.result import JobResult


class TaskWrapper:
    """
    Wraps a decorated function to provide task submission methods.

    Created by ``@queue.task()`` — not instantiated directly.
    """

    def __init__(
        self,
        fn: Callable,
        queue_ref: Queue,
        task_name: str,
        default_priority: int,
        default_queue: str,
        default_max_retries: int,
        default_timeout: int,
    ):
        """Initialize a task wrapper around a decorated function.

        Args:
            fn: The original decorated function.
            queue_ref: The parent Queue instance.
            task_name: Registered name for this task.
            default_priority: Default priority level.
            default_queue: Default queue name.
            default_max_retries: Default max retry attempts.
            default_timeout: Default timeout in seconds.
        """
        self._fn = fn
        self._queue = queue_ref
        self._task_name = task_name
        self._default_priority = default_priority
        self._default_queue = default_queue
        self._default_max_retries = default_max_retries
        self._default_timeout = default_timeout

    @property
    def name(self) -> str:
        """The registered task name."""
        return self._task_name

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        """Call the underlying function directly (synchronous, not queued)."""
        return self._fn(*args, **kwargs)

    def delay(self, *args: Any, **kwargs: Any) -> JobResult:
        """Enqueue this task for background execution.

        Shorthand for :meth:`apply_async` using the task's default options.
        Pass arguments exactly as you would call the function directly.

        Args:
            *args: Positional arguments forwarded to the task function.
            **kwargs: Keyword arguments forwarded to the task function.

        Returns:
            A :class:`~taskito.result.JobResult` handle for tracking the job.

        Example::

            job = send_email.delay("user@example.com", subject="Hello")
            print(job.result(timeout=30))
        """
        return self._queue.enqueue(
            task_name=self._task_name,
            args=args,
            kwargs=kwargs if kwargs else None,
            priority=self._default_priority,
            queue=self._default_queue,
            max_retries=self._default_max_retries,
            timeout=self._default_timeout,
        )

    def apply_async(
        self,
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
        """Enqueue with full control over submission options.

        Use this instead of :meth:`delay` when you need to override
        priority, set a delay, attach metadata, or declare dependencies.

        Args:
            args: Positional arguments to pass to the task.
            kwargs: Keyword arguments to pass to the task.
            priority: Override default priority (higher = more urgent).
            delay: Delay in seconds before the job becomes eligible to run.
            queue: Override the default queue name.
            max_retries: Override the default max retry count.
            timeout: Override the default timeout in seconds.
            unique_key: Deduplication key. If a pending or running job with
                the same key exists, returns that job instead.
            metadata: Arbitrary JSON string to attach to the job.
            depends_on: Job ID or list of job IDs that must complete before
                this job runs. If any dependency fails, this job is
                cascade-cancelled.

        Returns:
            A :class:`~taskito.result.JobResult` handle for the created
            (or deduplicated) job.

        Raises:
            ValueError: If *depends_on* references a non-existent job ID.

        Example::

            job = send_email.apply_async(
                args=("user@example.com",),
                priority=10,
                delay=60,
                unique_key="welcome:user_123",
            )
        """
        return self._queue.enqueue(
            task_name=self._task_name,
            args=args,
            kwargs=kwargs,
            priority=priority if priority is not None else self._default_priority,
            delay=delay,
            queue=queue or self._default_queue,
            max_retries=max_retries if max_retries is not None else self._default_max_retries,
            timeout=timeout if timeout is not None else self._default_timeout,
            unique_key=unique_key,
            metadata=metadata,
            depends_on=depends_on,
        )

    def map(self, iterable: list[tuple]) -> list[JobResult]:
        """Enqueue one job per item in a single batch transaction.

        Args:
            iterable: List of argument tuples, one per job.

        Returns:
            List of JobResult handles.
        """
        return self._queue.enqueue_many(
            task_name=self._task_name,
            args_list=iterable,
            priority=self._default_priority,
            queue=self._default_queue,
            max_retries=self._default_max_retries,
            timeout=self._default_timeout,
        )

    def s(self, *args: Any, **kwargs: Any) -> Signature:
        """Create a mutable :class:`~taskito.canvas.Signature`.

        In a :class:`~taskito.canvas.chain`, the previous task's return
        value is prepended to *args* automatically.

        Args:
            *args: Positional arguments for the task.
            **kwargs: Keyword arguments for the task.

        Returns:
            A :class:`~taskito.canvas.Signature` instance.

        Example::

            chain(fetch.s(url), parse.s(), store.s()).apply()
        """
        from taskito.canvas import Signature

        return Signature(task=self, args=args, kwargs=kwargs)

    def si(self, *args: Any, **kwargs: Any) -> Signature:
        """Create an immutable :class:`~taskito.canvas.Signature`.

        Unlike :meth:`s`, the previous task's return value is **not**
        prepended — the signature always runs with exactly the given args.

        Args:
            *args: Positional arguments for the task.
            **kwargs: Keyword arguments for the task.

        Returns:
            A :class:`~taskito.canvas.Signature` instance with
            ``immutable=True``.
        """
        from taskito.canvas import Signature

        return Signature(task=self, args=args, kwargs=kwargs, immutable=True)

    def __repr__(self) -> str:
        """Return a developer-friendly string representation."""
        return f"<TaskWrapper '{self._task_name}'>"
