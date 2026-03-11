# Observability

The resource system exposes metrics through three channels: the `Queue` API, the built-in dashboard, and Prometheus.

## Queue API

### `resource_status()`

Returns a snapshot of every registered resource:

```python
status = queue.resource_status()
# [
#   {
#     "name": "config",
#     "scope": "worker",
#     "health": "healthy",
#     "init_duration_ms": 12.4,
#     "recreations": 0,
#     "depends_on": [],
#   },
#   {
#     "name": "db",
#     "scope": "worker",
#     "health": "healthy",
#     "init_duration_ms": 45.2,
#     "recreations": 1,
#     "depends_on": ["config"],
#   },
#   {
#     "name": "session",
#     "scope": "task",
#     "health": "healthy",
#     "init_duration_ms": 0.0,
#     "recreations": 0,
#     "depends_on": ["db"],
#     "pool": {
#       "size": 20,
#       "active": 3,
#       "idle": 5,
#       "total_acquisitions": 1542,
#       "total_timeouts": 0,
#       "avg_acquire_ms": 0.4,
#     },
#   },
# ]
```

Task-scoped resources include a `"pool"` key with pool statistics. The `"health"` field is `"healthy"`, `"unhealthy"`, or `"unknown"` (resource not yet initialized).

### `interception_stats()`

Returns aggregate metrics from the argument interceptor:

```python
stats = queue.interception_stats()
# {
#   "total_intercepts": 1200,
#   "total_duration_ms": 216.0,
#   "avg_duration_ms": 0.18,
#   "strategy_counts": {
#     "pass": 2800,
#     "convert": 450,
#     "redirect": 200,
#     "proxy": 30,
#     "reject": 0,
#   },
#   "max_depth_reached": 3,
# }
```

Returns an empty dict if interception is disabled (`"off"`).

### `proxy_stats()`

Returns per-handler reconstruction metrics:

```python
stats = queue.proxy_stats()
# [
#   {
#     "handler": "file",
#     "total_reconstructions": 42,
#     "total_errors": 0,
#     "total_cleanup_errors": 0,
#     "total_checksum_failures": 0,
#     "total_duration_ms": 50.4,
#     "avg_duration_ms": 1.2,
#     "max_duration_ms": 8.1,
#     "p95_duration_ms": 3.4,
#   },
#   {
#     "handler": "boto3_client",
#     "total_reconstructions": 310,
#     "total_errors": 2,
#     ...
#   },
# ]
```

## Dashboard endpoints

The built-in dashboard exposes three JSON endpoints for the resource system:

| Endpoint | Description |
|---|---|
| `GET /api/resources` | Same data as `resource_status()` |
| `GET /api/proxy-stats` | Same data as `proxy_stats()` |
| `GET /api/interception-stats` | Same data as `interception_stats()` |

Start the dashboard:

```bash
taskito dashboard --app myapp.tasks:queue
```

See the [Web Dashboard](../guide/dashboard.md) guide for full dashboard documentation.

## CLI commands

### `taskito resources`

Print a formatted table of all registered resources and their current status:

```bash
taskito resources --app myapp.tasks:queue
# RESOURCE             SCOPE      HEALTH           INIT (ms)    RECREATIONS    DEPENDS ON
# -----------------------------------------------------------------------
# config               worker     healthy          12.40        0              -
# db                   worker     healthy          45.21        1              config
# session              task       healthy          0.00         0              db
#                           pool: active=3 idle=5 max=20 timeouts=0
```

### `taskito reload`

Send `SIGHUP` to a running worker to reload all reloadable resources:

```bash
taskito reload --pid 12345
# Sent SIGHUP to worker (PID 12345)

# Reload a specific resource only:
taskito reload --pid 12345 --resource feature_flags
```

!!! note
    `taskito reload` sends `SIGHUP` — it does not wait for the reload to complete. Check `taskito resources` or logs to confirm the reload succeeded.

## Prometheus metrics

Install the Prometheus integration:

```bash
pip install taskito[prometheus]
```

```python
from taskito.contrib.prometheus import PrometheusMiddleware, PrometheusStatsCollector

queue = Queue(db_path="tasks.db", middleware=[PrometheusMiddleware()])

# Poll resource, proxy, and interception stats periodically
collector = PrometheusStatsCollector(queue, interval=10.0)
collector.start()
```

### Resource metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `taskito_resource_health_status` | Gauge | `resource` | `1` if healthy, `0` if unhealthy |
| `taskito_resource_recreation_total` | Gauge | `resource` | Total recreation count |
| `taskito_resource_init_duration_seconds` | Gauge | `resource` | Initialization duration |
| `taskito_resource_pool_size` | Gauge | `resource` | Pool max size (task scope) |
| `taskito_resource_pool_active` | Gauge | `resource` | Active pool instances |
| `taskito_resource_pool_idle` | Gauge | `resource` | Idle pool instances |
| `taskito_resource_pool_timeout_total` | Counter | `resource` | Pool acquisition timeouts |

### Proxy metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `taskito_proxy_reconstruct_total` | Counter | `handler` | Total reconstructions |
| `taskito_proxy_reconstruct_errors_total` | Counter | `handler` | Reconstruction errors |
| `taskito_proxy_reconstruct_duration_seconds` | Histogram | `handler` | Reconstruction duration |

### Interception metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `taskito_intercept_strategy_total` | Counter | `strategy` | Count per strategy (`pass`, `convert`, `redirect`, `proxy`, `reject`) |
| `taskito_intercept_duration_seconds` | Histogram | — | Interception pass duration |

Metrics are exposed at `/metrics` on the dashboard server or via a standalone metrics server:

```python
from taskito.contrib.prometheus import start_metrics_server

start_metrics_server(port=9090)
```

See the [Prometheus integration](../integrations/prometheus.md) page for full setup instructions.
