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

    retry_delays: list[float] | None
    max_retry_delay: int | None
    max_concurrent: int | None
    circuit_breaker_half_open_probes: int | None
    circuit_breaker_half_open_success_rate: float | None

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
        max_retry_delay: int | None = None,
        max_concurrent: int | None = None,
        circuit_breaker_half_open_probes: int | None = None,
        circuit_breaker_half_open_success_rate: float | None = None,
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
    namespace: str | None

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
        scheduler_poll_interval_ms: int = 50,
        scheduler_reap_interval: int = 100,
        scheduler_cleanup_interval: int = 1200,
        namespace: str | None = None,
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
        delay_seconds_list: list[float | None] | None = None,
        unique_keys: list[str | None] | None = None,
        metadata_list: list[str | None] | None = None,
        expires_list: list[float | None] | None = None,
        result_ttl_list: list[int | None] | None = None,
    ) -> list[PyJob]: ...
    def list_jobs(
        self,
        status: str | None = None,
        queue: str | None = None,
        task_name: str | None = None,
        limit: int = 50,
        offset: int = 0,
        namespace: str | None = None,
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
        namespace: str | None = None,
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
        queue_configs: str | None = None,
        pool: str | None = None,
        app_path: str | None = None,
    ) -> None: ...
    def worker_heartbeat(
        self,
        worker_id: str,
        resource_health: str | None = None,
    ) -> list[str]: ...
    def set_worker_status(self, worker_id: str, status: str) -> None: ...
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
    def submit_workflow(
        self,
        name: str,
        version: int,
        dag_bytes: bytes,
        step_metadata_json: str,
        node_payloads: dict[str, bytes],
        queue_default: str = "default",
        params_json: str | None = None,
        deferred_node_names: list[str] | None = None,
        parent_run_id: str | None = None,
        parent_node_name: str | None = None,
        cache_hit_nodes: dict[str, str] | None = None,
    ) -> PyWorkflowHandle: ...
    def get_workflow_run_status(self, run_id: str) -> PyWorkflowRunStatus: ...
    def cancel_workflow_run(self, run_id: str) -> None: ...
    def mark_workflow_node_result(
        self,
        job_id: str,
        succeeded: bool,
        error: str | None = None,
        skip_cascade: bool = False,
        result_hash: str | None = None,
    ) -> tuple[str, str, str | None] | None: ...
    def get_base_run_node_data(self, base_run_id: str) -> list[tuple[str, str, str | None]]: ...
    def skip_workflow_node(self, run_id: str, node_name: str) -> None: ...
    def expand_fan_out(
        self,
        run_id: str,
        parent_node_name: str,
        child_names: list[str],
        child_payloads: list[bytes],
        task_name: str,
        queue: str,
        max_retries: int,
        timeout_ms: int,
        priority: int,
    ) -> list[str]: ...
    def create_deferred_job(
        self,
        run_id: str,
        node_name: str,
        payload: bytes,
        task_name: str,
        queue: str,
        max_retries: int,
        timeout_ms: int,
        priority: int,
    ) -> str: ...
    def check_fan_out_completion(
        self,
        run_id: str,
        parent_node_name: str,
    ) -> tuple[bool, list[str]] | None: ...
    def finalize_run_if_terminal(self, run_id: str) -> str | None: ...
    def set_workflow_node_waiting_approval(self, run_id: str, node_name: str) -> None: ...
    def resolve_workflow_gate(
        self,
        run_id: str,
        node_name: str,
        approved: bool,
        error: str | None = None,
    ) -> None: ...
    def get_workflow_definition_dag(self, run_id: str) -> bytes: ...
    def set_workflow_node_fan_out_count(self, run_id: str, node_name: str, count: int) -> None: ...

class PyWorkflowBuilder:
    """Rust-side workflow DAG builder.

    Only available when built with the ``workflows`` feature.
    """

    def __init__(self) -> None: ...
    def add_step(
        self,
        name: str,
        task_name: str,
        after: list[str] | None = None,
        queue: str | None = None,
        max_retries: int | None = None,
        timeout_ms: int | None = None,
        priority: int | None = None,
        args_template: str | None = None,
        kwargs_template: str | None = None,
        fan_out: str | None = None,
        fan_in: str | None = None,
        condition: str | None = None,
    ) -> None: ...
    def step_count(self) -> int: ...
    def step_names(self) -> list[str]: ...
    def serialize(self) -> tuple[bytes, str]: ...

class PyWorkflowHandle:
    """Opaque handle returned from ``PyQueue.submit_workflow``.

    Only available when built with the ``workflows`` feature.
    """

    run_id: str
    name: str
    definition_id: str

class PyWorkflowRunStatus:
    """Snapshot of a workflow run's state and per-node status.

    Only available when built with the ``workflows`` feature.
    """

    run_id: str
    state: str
    started_at: int | None
    completed_at: int | None
    error: str | None

    def node_statuses(self) -> dict[str, dict[str, Any]]: ...

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
