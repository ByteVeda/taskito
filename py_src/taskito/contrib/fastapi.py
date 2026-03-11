"""FastAPI integration for taskito.

Provides a plug-and-play APIRouter with job status, progress SSE streaming,
and dead letter queue management.

Usage::

    from fastapi import FastAPI
    from taskito import Queue
    from taskito.contrib.fastapi import TaskitoRouter

    queue = Queue()
    app = FastAPI()
    app.include_router(TaskitoRouter(queue), prefix="/tasks")

Requires the ``fastapi`` optional dependency::

    pip install taskito[fastapi]
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncGenerator
from typing import TYPE_CHECKING, Any

logger = logging.getLogger(__name__)

try:
    from fastapi import APIRouter, HTTPException, Query
    from fastapi.responses import StreamingResponse
    from pydantic import BaseModel
except ImportError as e:
    raise ImportError(
        "FastAPI integration requires 'fastapi' and 'pydantic'. "
        "Install with: pip install taskito[fastapi]"
    ) from e

if TYPE_CHECKING:
    from taskito.app import Queue


# ── Pydantic response models ────────────────────────────


class StatsResponse(BaseModel):
    """Queue statistics."""

    pending: int = 0
    running: int = 0
    completed: int = 0
    failed: int = 0
    dead: int = 0
    cancelled: int = 0


class JobResponse(BaseModel):
    """Job status and metadata."""

    id: str
    queue: str
    task_name: str
    status: str
    priority: int
    progress: int | None = None
    retry_count: int
    max_retries: int
    created_at: int
    scheduled_at: int
    started_at: int | None = None
    completed_at: int | None = None
    error: str | None = None
    timeout_ms: int
    unique_key: str | None = None
    metadata: str | None = None


class JobErrorResponse(BaseModel):
    """A single error from a job attempt."""

    id: str
    job_id: str
    attempt: int
    error: str
    failed_at: int


class CancelResponse(BaseModel):
    """Response from cancelling a job."""

    cancelled: bool


class RetryResponse(BaseModel):
    """Response from retrying a dead letter."""

    new_job_id: str


class DeadLetterResponse(BaseModel):
    """A dead letter queue entry."""

    id: str
    original_job_id: str
    queue: str
    task_name: str
    error: str | None = None
    retry_count: int
    failed_at: int
    metadata: str | None = None


class JobResultResponse(BaseModel):
    """Job result (serialized to string for safety)."""

    id: str
    status: str
    result: Any = None
    error: str | None = None


class HealthResponse(BaseModel):
    """Health check response."""

    status: str


class ReadinessResponse(BaseModel):
    """Readiness check response."""

    status: str
    checks: dict[str, Any]


# ── Router factory ───────────────────────────────────────


class TaskitoRouter(APIRouter):
    """FastAPI APIRouter pre-configured with taskito endpoints.

    Args:
        queue: The taskito Queue instance to expose.
        **kwargs: Passed to ``APIRouter.__init__()`` (e.g. ``prefix``,
            ``tags``, ``dependencies``).

    Example::

        app.include_router(
            TaskitoRouter(queue, tags=["tasks"]),
            prefix="/tasks",
        )
    """

    def __init__(self, queue: Queue, **kwargs: Any) -> None:
        kwargs.setdefault("tags", ["taskito"])
        super().__init__(**kwargs)
        self._queue = queue
        self._register_routes()

    def _register_routes(self) -> None:
        queue = self._queue

        @self.get("/stats", response_model=StatsResponse)
        async def get_stats() -> StatsResponse:
            """Get queue statistics."""
            stats = await queue.astats()
            return StatsResponse(**stats)

        @self.get("/jobs/{job_id}", response_model=JobResponse)
        def get_job(job_id: str) -> JobResponse:
            """Get a job by ID."""
            job = queue.get_job(job_id)
            if job is None:
                raise HTTPException(status_code=404, detail="Job not found")
            return JobResponse(**job.to_dict())

        @self.get("/jobs/{job_id}/errors", response_model=list[JobErrorResponse])
        def get_job_errors(job_id: str) -> list[JobErrorResponse]:
            """Get error history for a job."""
            errors = queue.job_errors(job_id)
            return [JobErrorResponse(**e) for e in errors]

        @self.get("/jobs/{job_id}/result", response_model=JobResultResponse)
        async def get_job_result(
            job_id: str,
            timeout: float = Query(default=0, ge=0, le=300),
        ) -> JobResultResponse:
            """Get job result. Set timeout > 0 for blocking wait."""
            job = queue.get_job(job_id)
            if job is None:
                raise HTTPException(status_code=404, detail="Job not found")

            if timeout > 0 and job.status not in ("complete", "failed", "dead", "cancelled"):
                try:
                    result = await job.aresult(timeout=timeout)
                    return JobResultResponse(
                        id=job_id,
                        status="complete",
                        result=_safe_serialize(result),
                    )
                except TimeoutError:
                    job.refresh()
                    return JobResultResponse(
                        id=job_id,
                        status=job.status,
                    )
                except RuntimeError as e:
                    job.refresh()
                    return JobResultResponse(
                        id=job_id,
                        status=job.status,
                        error=str(e),
                    )

            d = job.to_dict()
            result = None
            if d["status"] == "complete":
                try:
                    result = _safe_serialize(job.result(timeout=1))
                except Exception:
                    logger.exception("Failed to deserialize result for job %s", job_id)

            return JobResultResponse(
                id=job_id,
                status=d["status"],
                result=result,
                error=d.get("error"),
            )

        @self.get("/jobs/{job_id}/progress")
        async def stream_progress(job_id: str) -> StreamingResponse:
            """SSE stream of progress updates until job reaches terminal state."""
            job = queue.get_job(job_id)
            if job is None:
                raise HTTPException(status_code=404, detail="Job not found")

            async def event_stream() -> AsyncGenerator[str, None]:
                terminal = {"complete", "failed", "dead", "cancelled"}
                while True:
                    refreshed = queue.get_job(job_id)
                    if refreshed is None:
                        yield f"data: {json.dumps({'status': 'not_found'})}\n\n"
                        return

                    d = refreshed.to_dict()
                    payload = json.dumps({"status": d["status"], "progress": d["progress"]})
                    yield f"data: {payload}\n\n"

                    if d["status"] in terminal:
                        return

                    await asyncio.sleep(0.5)

            return StreamingResponse(
                event_stream(),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )

        @self.post("/jobs/{job_id}/cancel", response_model=CancelResponse)
        async def cancel_job(job_id: str) -> CancelResponse:
            """Cancel a pending job."""
            ok = await queue.acancel_job(job_id)
            return CancelResponse(cancelled=ok)

        @self.get("/dead-letters", response_model=list[DeadLetterResponse])
        async def list_dead_letters(
            limit: int = Query(default=20, ge=1, le=100),
            offset: int = Query(default=0, ge=0),
        ) -> list[DeadLetterResponse]:
            """List dead letter queue entries."""
            dead = await queue.adead_letters(limit=limit, offset=offset)
            return [DeadLetterResponse(**d) for d in dead]

        @self.post("/dead-letters/{dead_id}/retry", response_model=RetryResponse)
        async def retry_dead_letter(dead_id: str) -> RetryResponse:
            """Re-enqueue a dead letter job."""
            new_id = await queue.aretry_dead(dead_id)
            return RetryResponse(new_job_id=new_id)

        @self.get("/health", response_model=HealthResponse)
        async def health() -> HealthResponse:
            """Liveness check."""
            from taskito.health import check_health

            return HealthResponse(**check_health())

        @self.get("/readiness", response_model=ReadinessResponse)
        async def readiness() -> ReadinessResponse:
            """Readiness check."""
            from taskito.health import check_readiness

            return ReadinessResponse(**check_readiness(queue))

        @self.get("/stats/queues")
        async def get_queue_stats(
            queue_name: str | None = Query(default=None, alias="queue"),
        ) -> dict[str, Any]:
            """Get per-queue stats. If queue is specified, returns stats for that queue only."""
            if queue_name:
                return await queue.astats_by_queue(queue_name)
            return await queue.astats_all_queues()


def _safe_serialize(value: Any) -> Any:
    """Convert a value to something JSON-serializable."""
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [_safe_serialize(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _safe_serialize(v) for k, v in value.items()}
    return str(value)
