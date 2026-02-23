# Web Dashboard

taskito ships with a built-in web dashboard for monitoring jobs, inspecting dead letters, and managing your task queue in real time. The dashboard is a single-page application served directly from the Rust core -- **zero extra dependencies required**.

## Launching the Dashboard

=== "CLI"

    ```bash
    taskito dashboard --app myapp:queue
    ```

    The `--app` argument uses the same `module:attribute` format as the worker.

=== "Programmatic"

    ```python
    from taskito.dashboard import serve_dashboard
    from myapp import queue

    serve_dashboard(queue, host="0.0.0.0", port=8000)
    ```

By default the dashboard starts on `http://localhost:8080`.

### CLI Options

| Flag | Default | Description |
|---|---|---|
| `--app` | *required* | Module path to your `Queue` instance, e.g. `myapp:queue` |
| `--host` | `127.0.0.1` | Bind address |
| `--port` | `8080` | Bind port |

```bash
# Bind to all interfaces on port 9000
taskito dashboard --app myapp:queue --host 0.0.0.0 --port 9000
```

!!! tip "Running alongside the worker"
    The dashboard reads directly from the same SQLite database as the worker. You can run them side by side without any coordination:

    ```bash
    # Terminal 1
    taskito worker --app myapp:queue

    # Terminal 2
    taskito dashboard --app myapp:queue
    ```

## SPA Features

The dashboard is a self-contained single-page application with:

- **Dark mode** -- Toggle between light and dark themes. Preference is stored in `localStorage`.
- **Auto-refresh** -- Job stats and tables refresh automatically every 2 seconds. Disable with the pause button.
- **Status badges** -- Color-coded pills for each job status: :material-clock-outline: pending, :material-play: running, :material-check: completed, :material-alert: failed, :material-skull: dead, :material-cancel: cancelled.
- **Pagination** -- All job and dead letter tables are paginated for large queues.
- **Job detail view** -- Click any job to see its full payload, error history, retry count, progress, and metadata.
- **Dead letter management** -- Inspect, retry, or purge dead letters directly from the UI.

!!! info "Zero extra dependencies"
    The SPA is embedded directly in the Python package. No Node.js, no npm, no CDN -- just `pip install taskito`.

## REST API

The dashboard exposes a JSON API you can use independently of the UI. All endpoints return `application/json`.

### `GET /api/stats`

Queue statistics snapshot.

```json
{
  "pending": 12,
  "running": 3,
  "completed": 450,
  "failed": 2,
  "dead": 1,
  "cancelled": 0
}
```

### `GET /api/jobs`

Paginated list of jobs.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `status` | `string` | all | Filter by status: `pending`, `running`, `completed`, `failed`, `dead`, `cancelled` |
| `limit` | `int` | `50` | Page size |
| `offset` | `int` | `0` | Pagination offset |

```bash
curl http://localhost:8080/api/jobs?status=running&limit=10
```

### `GET /api/jobs/{id}`

Full detail for a single job, including error history and progress.

```bash
curl http://localhost:8080/api/jobs/01H5K6X...
```

```json
{
  "id": "01H5K6X...",
  "task_name": "myapp.tasks.process",
  "status": "completed",
  "queue": "default",
  "priority": 0,
  "progress": 100,
  "result": "\"done\"",
  "retry_count": 0,
  "created_at": 1700000000000,
  "started_at": 1700000001000,
  "completed_at": 1700000005000,
  "errors": [],
  "metadata": null
}
```

### `GET /api/dead-letters`

Paginated list of dead letter entries.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | `int` | `50` | Page size |
| `offset` | `int` | `0` | Pagination offset |

```bash
curl http://localhost:8080/api/dead-letters?limit=5
```

### `POST /api/dead-letters/{id}/retry`

Re-enqueue a dead letter job. Returns the new job ID.

```bash
curl -X POST http://localhost:8080/api/dead-letters/01H5K6X.../retry
```

```json
{
  "new_job_id": "01H5K7Y..."
}
```

### `DELETE /api/dead-letters/{id}`

Delete a single dead letter entry.

### `POST /api/jobs/{id}/cancel`

Cancel a pending job. Returns `204 No Content` on success or `409 Conflict` if the job is not in a cancellable state.

## Using the API Programmatically

You can integrate the dashboard API into your own monitoring stack:

```python
import requests

# Health check script
stats = requests.get("http://localhost:8080/api/stats").json()

if stats["dead"] > 0:
    print(f"WARNING: {stats['dead']} dead letter(s)")

if stats["running"] > 100:
    print(f"WARNING: {stats['running']} jobs running, possible backlog")
```

!!! warning "Authentication"
    The dashboard does not include authentication. If you expose it beyond `localhost`, place it behind a reverse proxy with authentication (e.g. nginx with basic auth, or an OAuth2 proxy).
