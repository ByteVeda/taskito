"""Type stubs for the Rust extension module."""

from __future__ import annotations

from typing import Any

class PyTaskConfig:
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
    ) -> None: ...

class PyJob:
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

    @property
    def status(self) -> str: ...
    @property
    def result_bytes(self) -> bytes | None: ...

class PyQueue:
    def __init__(
        self,
        db_path: str = "quickq.db",
        workers: int = 0,
        default_retry: int = 3,
        default_timeout: int = 300,
        default_priority: int = 0,
    ) -> None: ...
    def enqueue(
        self,
        task_name: str,
        payload: bytes,
        queue: str = "default",
        priority: int | None = None,
        delay_seconds: float | None = None,
        max_retries: int | None = None,
        timeout: int | None = None,
    ) -> PyJob: ...
    def get_job(self, job_id: str) -> PyJob | None: ...
    def stats(self) -> dict[str, int]: ...
    def dead_letters(self, limit: int = 10, offset: int = 0) -> list[dict[str, Any]]: ...
    def retry_dead(self, dead_id: str) -> str: ...
    def purge_dead(self, older_than_seconds: int) -> int: ...
    def run_worker(
        self,
        task_registry: dict[str, Any],
        task_configs: list[PyTaskConfig],
        queues: list[str] | None = None,
    ) -> None: ...
