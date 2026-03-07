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
| `GET` | `/jobs/{job_id}` | Job status, progress, and metadata |
| `GET` | `/jobs/{job_id}/errors` | Error history for a job |
| `GET` | `/jobs/{job_id}/result` | Job result (optional `?timeout=N` for blocking) |
| `GET` | `/jobs/{job_id}/progress` | SSE stream of progress updates |
| `POST` | `/jobs/{job_id}/cancel` | Cancel a pending job |
| `GET` | `/dead-letters` | List dead letter entries (paginated) |
| `POST` | `/dead-letters/{dead_id}/retry` | Re-enqueue a dead letter |

For full details on SSE streaming, blocking result fetch, Pydantic response models, and authentication, see the [Advanced guide](../guide/advanced.md#fastapi-integration).
