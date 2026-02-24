"""Type stubs for the Rust extension module."""

from __future__ import annotations

from typing import Any

class PyTaskConfig:
    """Configuration for a registered task.

    Holds retry policy, timeout, priority, rate limiting, and queue routing
    for a single task type. Passed to the Rust worker at startup.
    """

    name: str
    max_retries: int
    retry_backoff: float
    timeout: int
    priority: int
    rate_limit: str | None
    queue: str

    def __init__(
        self,
        name: str,
        max_retries: int = 3,
        retry_backoff: float = 1.0,
        timeout: int = 300,
        priority: int = 0,
        rate_limit: str | None = None,
        queue: str = "default",
    ) -> None:
        """Create a task configuration.

        Args:
            name: Unique task name (usually ``module.qualname``).
            max_retries: Max retry attempts before moving to dead letter queue.
            retry_backoff: Base delay in seconds for exponential backoff between retries.
            timeout: Max execution time in seconds before the task is killed.
            priority: Priority level (higher = more urgent).
            rate_limit: Rate limit string, e.g. ``"100/m"``, ``"10/s"``.
            queue: Named queue to route this task to.
        """
        ...

class PyJob:
    """A job record from the SQLite database.

    Represents a snapshot of a job's state. Fields are read-only and reflect
    the values at the time the job was fetched.
    """

    id: str
    """Unique job ID (ULID)."""
    queue: str
    """Queue this job belongs to."""
    task_name: str
    """Registered task name."""
    priority: int
    """Priority level (higher = more urgent)."""
    retry_count: int
    """Number of retries attempted so far."""
    max_retries: int
    """Maximum retry attempts allowed."""
    created_at: int
    """Unix timestamp (seconds) when the job was created."""
    scheduled_at: int
    """Unix timestamp (seconds) when the job becomes eligible to run."""
    started_at: int | None
    """Unix timestamp (seconds) when execution started, or None if not yet started."""
    completed_at: int | None
    """Unix timestamp (seconds) when execution finished, or None if not yet complete."""
    error: str | None
    """Error message from the most recent failure, or None."""
    timeout_ms: int
    """Task timeout in milliseconds."""
    unique_key: str | None
    """Deduplication key, or None if not set."""
    progress: int | None
    """Progress percentage (0-100) if reported by the task, or None."""
    metadata: str | None
    """JSON metadata string attached at enqueue time, or None."""

    @property
    def status(self) -> str:
        """Current job status.

        One of: ``"pending"``, ``"running"``, ``"complete"``,
        ``"failed"``, ``"dead"``, ``"cancelled"``.
        """
        ...
    @property
    def result_bytes(self) -> bytes | None:
        """Serialized (cloudpickle) return value, or None if not yet complete."""
        ...

class PyQueue:
    """Low-level Rust queue interface backed by SQLite.

    This is the native extension class. Prefer using :class:`taskito.Queue`
    which wraps this with a Pythonic API, hooks, and async support.
    """

    def __init__(
        self,
        db_path: str = "taskito.db",
        workers: int = 0,
        default_retry: int = 3,
        default_timeout: int = 300,
        default_priority: int = 0,
        result_ttl: int | None = None,
    ) -> None:
        """Initialize the Rust queue and SQLite database.

        Args:
            db_path: Path to the SQLite database file. Use ``":memory:"`` for
                an in-memory database (no persistence).
            workers: Number of worker threads. 0 means auto-detect CPU count.
            default_retry: Default max retry attempts for tasks.
            default_timeout: Default task timeout in seconds.
            default_priority: Default task priority (higher = more urgent).
            result_ttl: Auto-purge completed/dead jobs older than this many
                seconds. ``None`` disables auto-cleanup.
        """
        ...
    def request_shutdown(self) -> None:
        """Signal the worker to shut down gracefully after in-flight jobs complete."""
        ...
    def enqueue(
        self,
        task_name: str,
        payload: bytes,
        queue: str = "default",
        priority: int | None = None,
        delay_seconds: float | None = None,
        max_retries: int | None = None,
        timeout: int | None = None,
        unique_key: str | None = None,
        metadata: str | None = None,
        depends_on: list[str] | None = None,
    ) -> PyJob:
        """Enqueue a single job.

        Args:
            task_name: Registered task name.
            payload: Cloudpickle-serialized ``(args, kwargs)`` tuple.
            queue: Target queue name.
            priority: Job priority (overrides task default).
            delay_seconds: Delay before the job becomes eligible to run.
            max_retries: Max retries (overrides task default).
            timeout: Timeout in seconds (overrides task default).
            unique_key: Deduplication key. If a pending/running job with the
                same key exists, returns that job instead.
            metadata: JSON string to attach to the job.
            depends_on: Job IDs that must complete before this job runs.

        Returns:
            The created (or deduplicated) job record.
        """
        ...
    def enqueue_batch(
        self,
        task_names: list[str],
        payloads: list[bytes],
        queues: list[str] | None = None,
        priorities: list[int] | None = None,
        max_retries_list: list[int] | None = None,
        timeouts: list[int] | None = None,
    ) -> list[PyJob]:
        """Enqueue multiple jobs in a single SQLite transaction.

        Args:
            task_names: Task name for each job.
            payloads: Serialized payload for each job.
            queues: Queue name per job (None uses ``"default"`` for all).
            priorities: Priority per job (None uses task defaults).
            max_retries_list: Max retries per job (None uses task defaults).
            timeouts: Timeout per job in seconds (None uses task defaults).

        Returns:
            List of created job records.
        """
        ...
    def list_jobs(
        self,
        status: str | None = None,
        queue: str | None = None,
        task_name: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[PyJob]:
        """List jobs with optional filters and pagination.

        Args:
            status: Filter by status (e.g. ``"pending"``, ``"running"``). None returns all.
            queue: Filter by queue name. None returns all queues.
            task_name: Filter by task name. None returns all tasks.
            limit: Maximum number of jobs to return.
            offset: Number of jobs to skip (for pagination).

        Returns:
            List of job records, ordered by creation time (newest first).
        """
        ...
    def get_job(self, job_id: str) -> PyJob | None:
        """Get a job by ID. Returns ``None`` if not found."""
        ...
    def get_job_errors(self, job_id: str) -> list[dict[str, Any]]:
        """Get error history for a job (one entry per failed attempt)."""
        ...
    def cancel_job(self, job_id: str) -> bool:
        """Cancel a pending job. Returns ``True`` if cancelled, ``False`` if not pending."""
        ...
    def get_dependencies(self, job_id: str) -> list[str]:
        """Get IDs of jobs this job depends on."""
        ...
    def get_dependents(self, job_id: str) -> list[str]:
        """Get IDs of jobs that depend on this job."""
        ...
    def update_progress(self, job_id: str, progress: int) -> None:
        """Update progress for a running job (0-100)."""
        ...
    def purge_completed(self, older_than_seconds: int) -> int:
        """Purge completed jobs older than N seconds ago. Returns count deleted."""
        ...
    def stats(self) -> dict[str, int]:
        """Get queue statistics (pending, running, completed, failed, dead, cancelled counts)."""
        ...
    def dead_letters(self, limit: int = 10, offset: int = 0) -> list[dict[str, Any]]:
        """List dead letter queue entries (jobs that exhausted all retries)."""
        ...
    def retry_dead(self, dead_id: str) -> str:
        """Re-enqueue a dead letter job. Returns the new job ID."""
        ...
    def purge_dead(self, older_than_seconds: int) -> int:
        """Purge dead letter entries older than N seconds ago. Returns count deleted."""
        ...
    def register_periodic(
        self,
        name: str,
        task_name: str,
        cron_expr: str,
        args: bytes | None = None,
        kwargs: bytes | None = None,
        queue: str = "default",
    ) -> None:
        """Register a periodic task with the Rust scheduler.

        Args:
            name: Unique name for this periodic schedule.
            task_name: The registered task to invoke.
            cron_expr: Cron expression (6-field with seconds), e.g. ``"0 */5 * * * *"``.
            args: Cloudpickle-serialized args bytes, or None.
            kwargs: Cloudpickle-serialized kwargs bytes, or None.
            queue: Queue to enqueue the periodic job into.
        """
        ...
    def run_worker(
        self,
        task_registry: dict[str, Any],
        task_configs: list[PyTaskConfig],
        queues: list[str] | None = None,
    ) -> None:
        """Start the worker loop. Blocks until shutdown is requested.

        Args:
            task_registry: Mapping of task names to callable functions.
            task_configs: List of task configurations for rate limiting and retries.
            queues: List of queue names to consume from. None consumes all queues.
        """
        ...
