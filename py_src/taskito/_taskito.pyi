"""Type stubs for the Rust extension module."""

from __future__ import annotations

from typing import Any

class PyTaskConfig:
    """Configuration for a registered task."""

    name: str
    max_retries: int
    retry_backoff: float
    timeout: int
    priority: int
    rate_limit: str | None
    queue: str

    circuit_breaker_threshold: int | None
    circuit_breaker_window: int | None
    circuit_breaker_cooldown: int | None

    def __init__(
        self,
        name: str,
        max_retries: int = 3,
        retry_backoff: float = 1.0,
        timeout: int = 300,
        priority: int = 0,
        rate_limit: str | None = None,
        queue: str = "default",
        circuit_breaker_threshold: int | None = None,
        circuit_breaker_window: int | None = None,
        circuit_breaker_cooldown: int | None = None,
        retry_delays: list[float] | None = None,
    ) -> None: ...

class PyJob:
    """A job record from the database."""

    id: str
    queue: str
    task_name: str
    priority: int
    retry_count: int
    max_retries: int
    created_at: int
    scheduled_at: int
    started_at: int | None
    completed_at: int | None
    error: str | None
    timeout_ms: int
    unique_key: str | None
    progress: int | None
    metadata: str | None

    @property
    def status(self) -> str: ...
    @property
    def result_bytes(self) -> bytes | None: ...
    def __repr__(self) -> str: ...

class PyQueue:
    """Low-level Rust queue interface backed by SQLite, PostgreSQL, or Redis."""

    def __init__(
        self,
        db_path: str = ".taskito/taskito.db",
        workers: int = 0,
        default_retry: int = 3,
        default_timeout: int = 300,
        default_priority: int = 0,
        result_ttl: int | None = None,
        backend: str = "sqlite",
        db_url: str | None = None,
        schema: str = "taskito",
        pool_size: int | None = None,
    ) -> None: ...
    def request_shutdown(self) -> None: ...
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
        expires: float | None = None,
        result_ttl: int | None = None,
    ) -> PyJob: ...
    def enqueue_batch(
        self,
        task_names: list[str],
        payloads: list[bytes],
        queues: list[str] | None = None,
        priorities: list[int] | None = None,
        max_retries_list: list[int] | None = None,
        timeouts: list[int] | None = None,
    ) -> list[PyJob]: ...
    def list_jobs(
        self,
        status: str | None = None,
        queue: str | None = None,
        task_name: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[PyJob]: ...
    def get_job(self, job_id: str) -> PyJob | None: ...
    def get_job_errors(self, job_id: str) -> list[dict[str, Any]]: ...
    def cancel_job(self, job_id: str) -> bool: ...
    def request_cancel(self, job_id: str) -> bool: ...
    def is_cancel_requested(self, job_id: str) -> bool: ...
    def get_dependencies(self, job_id: str) -> list[str]: ...
    def get_dependents(self, job_id: str) -> list[str]: ...
    def update_progress(self, job_id: str, progress: int) -> None: ...
    def purge_completed(self, older_than_seconds: int) -> int: ...
    def stats(self) -> dict[str, int]: ...
    def stats_by_queue(self, queue_name: str) -> dict[str, int]: ...
    def stats_all_queues(self) -> dict[str, dict[str, int]]: ...
    def list_jobs_filtered(
        self,
        status: str | None = None,
        queue: str | None = None,
        task_name: str | None = None,
        metadata_like: str | None = None,
        error_like: str | None = None,
        created_after: int | None = None,
        created_before: int | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[PyJob]: ...
    def dead_letters(self, limit: int = 10, offset: int = 0) -> list[dict[str, Any]]: ...
    def retry_dead(self, dead_id: str) -> str: ...
    def purge_dead(self, older_than_seconds: int) -> int: ...
    def register_periodic(
        self,
        name: str,
        task_name: str,
        cron_expr: str,
        args: bytes | None = None,
        kwargs: bytes | None = None,
        queue: str = "default",
        timezone: str | None = None,
    ) -> None: ...
    def run_worker(
        self,
        task_registry: dict[str, Any],
        task_configs: list[PyTaskConfig],
        queues: list[str] | None = None,
        drain_timeout_secs: int | None = None,
        tags: str | None = None,
        worker_id: str | None = None,
        resources: str | None = None,
        threads: int = 1,
        async_concurrency: int = 100,
    ) -> None: ...
    def worker_heartbeat(
        self,
        worker_id: str,
        resource_health: str | None = None,
    ) -> None: ...
    def pause_queue(self, queue_name: str) -> None: ...
    def resume_queue(self, queue_name: str) -> None: ...
    def list_paused_queues(self) -> list[str]: ...
    def purge_queue(self, queue_name: str) -> int: ...
    def revoke_task(self, task_name: str) -> int: ...
    def archive_old_jobs(self, older_than_seconds: int) -> int: ...
    def list_archived(self, limit: int = 50, offset: int = 0) -> list[PyJob]: ...
    def get_metrics(
        self,
        task_name: str | None = None,
        since_seconds: int = 3600,
    ) -> list[dict[str, Any]]: ...
    def replay_job(self, job_id: str) -> str: ...
    def get_replay_history(self, job_id: str) -> list[dict[str, Any]]: ...
    def write_task_log(
        self,
        job_id: str,
        task_name: str,
        level: str,
        message: str,
        extra: str | None = None,
    ) -> None: ...
    def get_task_logs(self, job_id: str) -> list[dict[str, Any]]: ...
    def query_task_logs(
        self,
        task_name: str | None = None,
        level: str | None = None,
        since_seconds: int = 3600,
        limit: int = 100,
    ) -> list[dict[str, Any]]: ...
    def list_circuit_breakers(self) -> list[dict[str, Any]]: ...
    def list_workers(self) -> list[dict[str, Any]]: ...
    def acquire_lock(
        self,
        lock_name: str,
        owner_id: str,
        ttl_ms: int = 30000,
    ) -> bool: ...
    def release_lock(self, lock_name: str, owner_id: str) -> bool: ...
    def extend_lock(
        self,
        lock_name: str,
        owner_id: str,
        ttl_ms: int = 30000,
    ) -> bool: ...
    def get_lock_info(self, lock_name: str) -> dict[str, Any] | None: ...

class PyResultSender:
    """Sends task results from Python async executor back to Rust scheduler.

    Only available when built with the ``native-async`` feature.
    """

    def report_success(
        self,
        job_id: str,
        task_name: str,
        result: bytes | None,
        wall_time_ns: int,
    ) -> None: ...
    def report_failure(
        self,
        job_id: str,
        task_name: str,
        error: str,
        retry_count: int,
        max_retries: int,
        wall_time_ns: int,
        should_retry: bool,
    ) -> None: ...
    def report_cancelled(
        self,
        job_id: str,
        task_name: str,
        wall_time_ns: int,
    ) -> None: ...
