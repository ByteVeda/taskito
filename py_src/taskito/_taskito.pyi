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
    ) -> None: ...

class PyJob:
    """A job record from the SQLite database."""

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

class PyQueue:
    """Low-level Rust queue interface backed by SQLite."""

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
    ) -> None: ...
    def run_worker(
        self,
        task_registry: dict[str, Any],
        task_configs: list[PyTaskConfig],
        queues: list[str] | None = None,
    ) -> None: ...
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
