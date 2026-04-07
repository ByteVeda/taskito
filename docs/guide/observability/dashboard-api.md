# Dashboard REST API

The dashboard exposes a JSON API you can use independently of the UI. All endpoints return `application/json` with `Access-Control-Allow-Origin: *`.

## Stats

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

### `GET /api/stats/queues`

Per-queue statistics. Pass `?queue=name` for a single queue, or omit for all queues.

```bash
curl http://localhost:8080/api/stats/queues
curl http://localhost:8080/api/stats/queues?queue=emails
```

## Jobs

### `GET /api/jobs`

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

### `GET /api/jobs/{id}`

Full detail for a single job.

### `GET /api/jobs/{id}/errors`

Error history for a job (one entry per failed attempt).

### `GET /api/jobs/{id}/logs`

Task execution logs for a specific job.

### `GET /api/jobs/{id}/replay-history`

Replay history for a job that has been replayed.

### `GET /api/jobs/{id}/dag`

Dependency graph for a job (nodes and edges).

### `POST /api/jobs/{id}/cancel`

Cancel a pending job.

```json
{ "cancelled": true }
```

### `POST /api/jobs/{id}/replay`

Replay a completed or failed job with the same payload.

```json
{ "replay_job_id": "01H5K7Y..." }
```

## Dead Letters

### `GET /api/dead-letters`

Paginated list of dead letter entries. Supports `limit` and `offset` parameters.

### `POST /api/dead-letters/{id}/retry`

Re-enqueue a dead letter job.

```json
{ "new_job_id": "01H5K7Y..." }
```

### `POST /api/dead-letters/purge`

Purge all dead letters.

```json
{ "purged": 42 }
```

## Metrics

### `GET /api/metrics`

Per-task execution metrics.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `task` | `string` | all | Filter by task name |
| `since` | `int` | `3600` | Lookback window in seconds |

### `GET /api/metrics/timeseries`

Time-bucketed metrics for charts.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `task` | `string` | all | Filter by task name |
| `since` | `int` | `3600` | Lookback window in seconds |
| `bucket` | `int` | `60` | Bucket size in seconds |

## Logs

### `GET /api/logs`

Query task execution logs across all jobs.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `task` | `string` | all | Filter by task name |
| `level` | `string` | all | Filter by log level |
| `since` | `int` | `3600` | Lookback window in seconds |
| `limit` | `int` | `100` | Max entries |

## Infrastructure

### `GET /api/workers`

List registered workers with heartbeat status.

### `GET /api/circuit-breakers`

Current state of all circuit breakers.

### `GET /api/resources`

Worker resource health and pool status.

### `GET /api/queues/paused`

List paused queue names.

### `POST /api/queues/{name}/pause`

Pause a queue (jobs stop being dequeued).

### `POST /api/queues/{name}/resume`

Resume a paused queue.

## Observability

### `GET /api/proxy-stats`

Per-handler proxy reconstruction metrics.

### `GET /api/interception-stats`

Interception strategy performance metrics.

### `GET /api/scaler`

KEDA-compatible autoscaler payload. Pass `?queue=name` for a specific queue.

### `GET /health`

Liveness check. Always returns `{"status": "ok"}`.

### `GET /readiness`

Readiness check with storage, worker, and resource health.

### `GET /metrics`

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
