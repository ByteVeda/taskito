# Web Dashboard

taskito ships with a built-in web dashboard for monitoring jobs, inspecting dead letters, and managing your task queue in real time. The dashboard is a single-page application served directly from the Python package -- **zero extra dependencies required**.

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

## Dashboard Features

The dashboard is built with Preact, Tailwind CSS, and TypeScript, compiled into a single self-contained HTML file.

### Design

- **Dark and light mode** -- Toggle between themes via the header button. Preference is stored in `localStorage`.
- **Auto-refresh** -- Configurable refresh interval (2s, 5s, 10s, or off) via the header dropdown.
- **Icons** -- Lucide icons throughout for visual clarity.
- **Toast notifications** -- Action feedback (cancel, retry, replay, pause, resume, purge) with auto-dismissing toasts.
- **Loading states** -- Spinners and skeleton screens during data fetches.
- **Responsive layout** -- Sidebar navigation with grouped sections, collapsible on smaller screens.

### Pages

| Page | Description |
|---|---|
| **Overview** | Stats cards with status icons, throughput sparkline chart, recent jobs table |
| **Jobs** | Filterable job listing (status, queue, task, metadata, error, date range) with pagination |
| **Job Detail** | Full job info, error history, task logs, replay history, dependency DAG visualization |
| **Metrics** | Per-task performance table (avg, P50, P95, P99) with timeseries chart and time range selector |
| **Logs** | Structured task execution logs with task/level filters |
| **Workers** | Worker cards with heartbeat status, queue assignments, and tags |
| **Queues** | Per-queue stats (pending/running), pause and resume controls |
| **Resources** | Worker DI runtime status -- health, scope, init duration, pool stats, dependencies |
| **Circuit Breakers** | Automatic failure protection state (closed/open/half_open), thresholds, cooldowns |
| **Dead Letters** | Failed jobs that exhausted retries -- retry individual entries or purge all |
| **System** | Proxy reconstruction and interception strategy metrics |

!!! info "Zero extra dependencies"
    The SPA is embedded directly in the Python package. No Node.js, no npm, no CDN -- just `pip install taskito`. Node.js is only needed by contributors who modify the dashboard source.

## REST API

The dashboard exposes a JSON API you can use independently of the UI. All endpoints return `application/json` with `Access-Control-Allow-Origin: *`.

### Stats

#### `GET /api/stats`

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

#### `GET /api/stats/queues`

Per-queue statistics. Pass `?queue=name` for a single queue, or omit for all queues.

```bash
curl http://localhost:8080/api/stats/queues
curl http://localhost:8080/api/stats/queues?queue=emails
```

### Jobs

#### `GET /api/jobs`

Paginated list of jobs with filtering.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `status` | `string` | all | Filter by status |
| `queue` | `string` | all | Filter by queue name |
| `task` | `string` | all | Filter by task name |
| `metadata` | `string` | — | Search metadata (LIKE) |
| `error` | `string` | — | Search error text (LIKE) |
| `created_after` | `int` | — | Unix ms timestamp |
| `created_before` | `int` | — | Unix ms timestamp |
| `limit` | `int` | `20` | Page size |
| `offset` | `int` | `0` | Pagination offset |

```bash
curl http://localhost:8080/api/jobs?status=running&limit=10
```

#### `GET /api/jobs/{id}`

Full detail for a single job.

#### `GET /api/jobs/{id}/errors`

Error history for a job (one entry per failed attempt).

#### `GET /api/jobs/{id}/logs`

Task execution logs for a specific job.

#### `GET /api/jobs/{id}/replay-history`

Replay history for a job that has been replayed.

#### `GET /api/jobs/{id}/dag`

Dependency graph for a job (nodes and edges).

#### `POST /api/jobs/{id}/cancel`

Cancel a pending job.

```json
{ "cancelled": true }
```

#### `POST /api/jobs/{id}/replay`

Replay a completed or failed job with the same payload.

```json
{ "replay_job_id": "01H5K7Y..." }
```

### Dead Letters

#### `GET /api/dead-letters`

Paginated list of dead letter entries. Supports `limit` and `offset` parameters.

#### `POST /api/dead-letters/{id}/retry`

Re-enqueue a dead letter job.

```json
{ "new_job_id": "01H5K7Y..." }
```

#### `POST /api/dead-letters/purge`

Purge all dead letters.

```json
{ "purged": 42 }
```

### Metrics

#### `GET /api/metrics`

Per-task execution metrics.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `task` | `string` | all | Filter by task name |
| `since` | `int` | `3600` | Lookback window in seconds |

#### `GET /api/metrics/timeseries`

Time-bucketed metrics for charts.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `task` | `string` | all | Filter by task name |
| `since` | `int` | `3600` | Lookback window in seconds |
| `bucket` | `int` | `60` | Bucket size in seconds |

### Logs

#### `GET /api/logs`

Query task execution logs across all jobs.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `task` | `string` | all | Filter by task name |
| `level` | `string` | all | Filter by log level |
| `since` | `int` | `3600` | Lookback window in seconds |
| `limit` | `int` | `100` | Max entries |

### Infrastructure

#### `GET /api/workers`

List registered workers with heartbeat status.

#### `GET /api/circuit-breakers`

Current state of all circuit breakers.

#### `GET /api/resources`

Worker resource health and pool status.

#### `GET /api/queues/paused`

List paused queue names.

#### `POST /api/queues/{name}/pause`

Pause a queue (jobs stop being dequeued).

#### `POST /api/queues/{name}/resume`

Resume a paused queue.

### Observability

#### `GET /api/proxy-stats`

Per-handler proxy reconstruction metrics.

#### `GET /api/interception-stats`

Interception strategy performance metrics.

#### `GET /api/scaler`

KEDA-compatible autoscaler payload. Pass `?queue=name` for a specific queue.

#### `GET /health`

Liveness check. Always returns `{"status": "ok"}`.

#### `GET /readiness`

Readiness check with storage, worker, and resource health.

#### `GET /metrics`

Prometheus metrics endpoint (requires `prometheus-client` package).

## Using the API Programmatically

```python
import requests

# Health check script
stats = requests.get("http://localhost:8080/api/stats").json()

if stats["dead"] > 0:
    print(f"WARNING: {stats['dead']} dead letter(s)")

if stats["running"] > 100:
    print(f"WARNING: {stats['running']} jobs running, possible backlog")
```

## Development

Contributors who want to modify the dashboard source:

```bash
# Install dependencies
cd dashboard && npm install

# Start Vite dev server (proxies /api/* to localhost:8080)
npm run dev

# In another terminal, start the backend
taskito dashboard --app myapp:queue

# Build and copy to Python package
npm run build
```

The build script compiles the Preact app into a single HTML file and copies it to `py_src/taskito/templates/dashboard.html`. This file is committed to the repository so Python-only users never need Node.js.

!!! warning "Authentication"
    The dashboard does not include authentication. If you expose it beyond `localhost`, place it behind a reverse proxy with authentication (e.g. nginx with basic auth, or an OAuth2 proxy).
