"""Task wrapper providing .delay() and .apply_async() methods."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Callable

if TYPE_CHECKING:
    from quickq.app import Queue
    from quickq.result import JobResult


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
        """
        Enqueue this task for background execution with the given arguments.
        Returns a JobResult handle.
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
    ) -> JobResult:
        """
        Enqueue with full control over submission options.

        Args:
            args: Positional arguments to pass to the task.
            kwargs: Keyword arguments to pass to the task.
            priority: Override default priority (higher = more urgent).
            delay: Delay in seconds before the task becomes eligible to run.
            queue: Override the default queue name.
            max_retries: Override the default max retry count.
            timeout: Override the default timeout in seconds.
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
        )

    def __repr__(self) -> str:
        """Return a developer-friendly string representation."""
        return f"<TaskWrapper '{self._task_name}'>"
