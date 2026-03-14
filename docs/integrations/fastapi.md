# FastAPI Integration

taskito provides a pre-built `APIRouter` for FastAPI with endpoints for job management, progress streaming via SSE, and dead letter queue operations.

## Installation

```bash
pip install taskito[fastapi]
```

This installs `fastapi` and `pydantic` as extras.

## Quick Setup

```python
from fastapi import FastAPI
from taskito import Queue
from taskito.contrib.fastapi import TaskitoRouter

queue = Queue(db_path="myapp.db")

@queue.task()
def process_data(payload: dict) -> str:
    return "done"

app = FastAPI()
app.include_router(TaskitoRouter(queue), prefix="/tasks")
```

Run with:

```bash
uvicorn myapp:app --reload
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/stats` | Queue statistics |
| `GET` | `/stats/queues` | Per-queue statistics |
| `GET` | `/jobs/{job_id}` | Job status, progress, and metadata |
| `GET` | `/jobs/{job_id}/errors` | Error history for a job |
| `GET` | `/jobs/{job_id}/result` | Job result (optional `?timeout=N` for blocking) |
| `GET` | `/jobs/{job_id}/progress` | SSE stream of progress updates |
| `POST` | `/jobs/{job_id}/cancel` | Cancel a pending job |
| `GET` | `/dead-letters` | List dead letter entries (paginated) |
| `POST` | `/dead-letters/{dead_id}/retry` | Re-enqueue a dead letter |
| `GET` | `/health` | Liveness check |
| `GET` | `/readiness` | Readiness check |
| `GET` | `/resources` | Worker resource status |

## Configuration

`TaskitoRouter` accepts options to control which routes are registered, how results are serialized, and page sizes:

```python
from fastapi import Depends, HTTPException
from taskito.contrib.fastapi import TaskitoRouter

def require_api_key(x_api_key: str = Header(...)):
    if x_api_key != "secret":
        raise HTTPException(status_code=403)

app.include_router(
    TaskitoRouter(
        queue,
        include_routes={"stats", "jobs", "dead-letters", "retry-dead"},
        dependencies=[Depends(require_api_key)],
        sse_poll_interval=1.0,
        result_timeout=5.0,
        default_page_size=25,
        max_page_size=200,
        result_serializer=lambda v: v if isinstance(v, (str, int, float, bool, None)) else str(v),
    ),
    prefix="/tasks",
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `include_routes` | `set[str] \| None` | `None` | If set, only register these route names. Cannot be combined with `exclude_routes`. |
| `exclude_routes` | `set[str] \| None` | `None` | If set, skip these route names. Cannot be combined with `include_routes`. |
| `dependencies` | `Sequence[Depends] \| None` | `None` | FastAPI dependencies applied to every route (e.g. auth). |
| `sse_poll_interval` | `float` | `0.5` | Seconds between SSE progress polls. |
| `result_timeout` | `float` | `1.0` | Default timeout for non-blocking result fetch. |
| `default_page_size` | `int` | `20` | Default page size for paginated endpoints. |
| `max_page_size` | `int` | `100` | Maximum allowed page size. |
| `result_serializer` | `Callable[[Any], Any] \| None` | `None` | Custom result serializer. Receives any value, must return a JSON-serializable value. |

Valid route names: `stats`, `jobs`, `job-errors`, `job-result`, `job-progress`, `cancel`, `dead-letters`, `retry-dead`, `health`, `readiness`, `resources`, `queue-stats`.

For full details on SSE streaming, blocking result fetch, Pydantic response models, and authentication, see the [Advanced guide](../guide/advanced.md#fastapi-integration).
