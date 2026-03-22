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

- **Dark and light mode** -- Toggle between themes via the sun/moon button in the header. Preference is stored in `localStorage` and persists across sessions.
- **Auto-refresh** -- Configurable refresh interval (2s, 5s, 10s, or off) via the header dropdown. All pages auto-refresh at the selected interval.
- **Icons** -- Lucide icons throughout for visual clarity — every nav item, stat card, and action button has a meaningful icon.
- **Toast notifications** -- Every action (cancel, retry, replay, pause, resume, purge) shows a success or error toast in the bottom-right corner. Toasts auto-dismiss after 3 seconds.
- **Loading states** -- Spinners while data loads, skeleton screens for tables and cards.
- **Responsive layout** -- Sidebar navigation with grouped sections (Monitoring, Infrastructure, Advanced). The main content area scrolls independently.

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

## Tutorial

This walkthrough covers every dashboard page and how to use it.

### Step 1: Start the Dashboard

Start a worker and the dashboard in two terminals:

```bash
# Terminal 1 — start the worker
taskito worker --app myapp:queue

# Terminal 2 — start the dashboard
taskito dashboard --app myapp:queue
```

You should see:

```
taskito dashboard → http://127.0.0.1:8080
Press Ctrl+C to stop
```

Open `http://localhost:8080` in your browser.

### Step 2: Overview Page

The first page you see is the **Overview**. It shows:

- **Stats cards** -- Six cards at the top showing pending, running, completed, failed, dead, and cancelled job counts. Each card has a colored icon matching its status.
- **Throughput chart** -- A green sparkline showing jobs processed per second over the last 60 refresh intervals. The current throughput value is displayed in the top-right.
- **Recent jobs table** -- The 10 most recent jobs. Click any row to open its detail view.

The stats update automatically based on the refresh interval you select in the header (default: 5 seconds).

### Step 3: Browsing and Filtering Jobs

Click **Jobs** in the sidebar. This page shows:

- **Stats grid** -- Same six stat cards as the overview.
- **Filter panel** -- A card with seven filter fields:
    - **Status dropdown** -- Filter by pending, running, complete, failed, dead, or cancelled.
    - **Queue** -- Text input to filter by queue name.
    - **Task** -- Text input to filter by task name.
    - **Metadata** -- Search within job metadata (uses SQL LIKE).
    - **Error text** -- Search within error messages.
    - **Created after / before** -- Date pickers for time-range filtering.
- **Results table** -- Paginated list showing ID, task, queue, status, priority, progress, retries, and created time. Click any row to see the full job detail.

Use the **Prev / Next** buttons at the bottom to paginate. The current page range is shown (e.g., "Showing 1–20 items").

### Step 4: Inspecting a Job

Click any job row to open the **Job Detail** page. The detail card shows:

- A colored top border matching the job status (green for complete, red for failed, etc.)
- Full job ID, status badge, task name, queue, priority, progress bar, retries, timestamps
- **Error** field (if the job failed) displayed in a red-highlighted box
- Unique key and metadata (if set)

**Actions:**

- **Cancel Job** -- Visible only for pending jobs. Sends a cancel request and shows a toast.
- **Replay** -- Re-enqueue the job with the same payload. Navigates to the new job's detail page.

**Sections below the detail card:**

- **Error History** -- One row per failed attempt, showing the attempt number, error message, and timestamp.
- **Task Logs** -- Structured log entries emitted during task execution (time, level, message, extra data).
- **Replay History** -- If the job has been replayed, shows each replay with the original and replay errors.
- **Dependency Graph** -- If the job has dependencies, renders an SVG visualization with colored nodes (click a node to navigate to that job).

Click **← Back to jobs** at the bottom to return.

### Step 5: Monitoring Metrics

Click **Metrics** in the sidebar. This page shows:

- **Time range selector** -- Three buttons in the top-right: **1h**, **6h**, **24h**. Controls the lookback window for both the chart and the table.
- **Timeseries chart** -- Stacked bar chart showing success (green) and failure (red) counts per time bucket. X-axis shows timestamps, Y-axis shows job counts.
- **Per-task table** -- One row per task name with columns:
    - Total, Success (green), Failures (red if > 0)
    - Avg, P50, P95, P99, Min, Max latency — color-coded green/yellow/red based on thresholds

### Step 6: Viewing Logs

Click **Logs** in the sidebar. This page shows structured task execution logs from the last hour:

- **Filter by task** -- Text input to narrow logs to a specific task name.
- **Filter by level** -- Dropdown to show only error, warning, info, or debug logs.
- **Log table** -- Time, level badge (colored), task name, job ID (clickable link), message, and extra data.

### Step 7: Checking Workers

Click **Workers** in the sidebar. Each active worker is displayed as a card showing:

- **Green dot** -- Indicates the worker is alive.
- **Worker ID** -- The unique identifier in monospace text.
- **Queues** -- Which queues the worker consumes from.
- **Last heartbeat** -- When the worker last reported in. If this is stale (many seconds old), the worker may be hung or dead.
- **Registered at** -- When the worker connected.
- **Tags** -- Custom worker tags (if configured).

The header shows the total number of active workers and currently running jobs.

### Step 8: Managing Queues

Click **Queues** in the sidebar. This page shows:

- **Per-queue table** -- Each queue with its pending count (yellow), running count (blue), and status badge.
- **Pause button** -- Pauses the queue so no new jobs are dequeued. Workers currently running jobs on that queue will finish, but no new work starts. A toast confirms the action.
- **Resume button** -- Resumes a paused queue. Processing starts again immediately.

!!! note "What pausing does"
    Pausing a queue prevents the scheduler from dequeuing new jobs from it. Jobs already running will complete normally. Enqueuing new jobs still works — they'll be picked up when the queue is resumed.

### Step 9: Inspecting Resources

Click **Resources** in the sidebar. This page shows the worker dependency injection runtime:

- **Name** -- The resource name as registered with `@queue.worker_resource()`.
- **Scope** -- WORKER, TASK, THREAD, or REQUEST.
- **Health** -- Badge showing healthy (green), unhealthy (red), or degraded (yellow).
- **Init (ms)** -- How long the resource took to initialize.
- **Recreations** -- Number of times the resource was re-created (e.g., after a health check failure).
- **Dependencies** -- Other resources this one depends on.
- **Pool** -- For pooled resources: active/total count and idle workers.

### Step 10: Circuit Breakers

Click **Circuit Breakers** in the sidebar. Each circuit breaker shows:

- **State** -- Badge: closed (green, normal), open (red, tripping), or half_open (yellow, testing recovery).
- **Failure count** -- Current failures within the window.
- **Threshold** -- Failures needed to trip open.
- **Window / Cooldown** -- Time windows for failure counting and recovery.

### Step 11: Dead Letter Queue

Click **Dead Letters** in the sidebar. This page shows jobs that failed all retry attempts:

- **Retry button** -- Re-enqueue an individual dead letter as a new job. A toast shows the result.
- **Purge All** -- Button in the top-right header. Opens a confirmation dialog before deleting all dead letters permanently.
- **Error column** -- Shows the final error message (truncated, hover for full text).
- **Original Job** -- Clickable link to the job that originally failed.

### Step 12: System Internals

Click **System** in the sidebar. Two tables:

- **Proxy Reconstruction** -- Per-handler metrics for non-serializable object proxying (reconstructions, average duration, errors).
- **Interception** -- Per-strategy metrics for argument interception (count, average duration).

These are empty unless your app uses the proxy or interception features.

### Step 13: Switching Themes

Click the **sun icon** (in dark mode) or **moon icon** (in light mode) in the top-right of the header. The theme switches immediately and persists in `localStorage`.

### Step 14: Changing Refresh Rate

Use the **Refresh** dropdown in the header to change how often all data refreshes:

- **2s** -- Near-real-time monitoring.
- **5s** -- Default, good balance.
- **10s** -- Low-frequency polling.
- **Off** -- Manual only (reload the page to refresh).

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

```python
# Pause a queue during deployment
requests.post("http://localhost:8080/api/queues/default/pause")

# ... deploy ...

# Resume after deployment
requests.post("http://localhost:8080/api/queues/default/resume")
```

```python
# Retry all dead letters
dead = requests.get("http://localhost:8080/api/dead-letters?limit=100").json()
for entry in dead:
    requests.post(f"http://localhost:8080/api/dead-letters/{entry['id']}/retry")
    print(f"Retried {entry['task_name']}")
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

### How the build works

```
dashboard/src/ (Preact + TypeScript)
    ↓ npm run build
    ↓ Vite compiles, tree-shakes, and minifies
    ↓ vite-plugin-singlefile inlines all JS and CSS
    ↓ Copies to py_src/taskito/templates/dashboard.html
    ↓
py_src/taskito/templates/dashboard.html (128KB self-contained)
    ↓ pip install / maturin develop
    ↓ Bundled in the Python wheel
    ↓
dashboard.py reads it via importlib.resources
    ↓ Serves via Python stdlib http.server
    ↓
Browser loads single HTML → Preact SPA boots → fetches /api/*
```

### Project structure

```
dashboard/
├── package.json          # Dependencies: preact, @preact/signals, lucide-preact, tailwindcss
├── vite.config.ts        # Vite + Preact + Tailwind + singlefile plugins, API proxy
├── tsconfig.json         # TypeScript config (strict, Preact JSX)
├── index.html            # Vite entry point
└── src/
    ├── main.tsx          # Mount point
    ├── app.tsx           # Router setup (preact-router)
    ├── index.css         # Tailwind directives, theme tokens, animations
    ├── api/              # API client and TypeScript types
    ├── hooks/            # useApi, useAutoRefresh, useTheme, useToast
    ├── components/
    │   ├── layout/       # Shell, Header, Sidebar
    │   └── ui/           # Badge, Button, DataTable, StatCard, Toast, etc.
    ├── charts/           # ThroughputChart, TimeseriesChart, DagViewer
    ├── pages/            # One file per page (11 total)
    └── lib/              # Format helpers, route constants
```

!!! warning "Authentication"
    The dashboard does not include authentication. If you expose it beyond `localhost`, place it behind a reverse proxy with authentication (e.g. nginx with basic auth, or an OAuth2 proxy).
