# Prometheus Metrics

taskito provides Prometheus metrics via a middleware and an optional stats collector thread.

## Installation

```bash
pip install taskito[prometheus]
```

This installs `prometheus-client` as a dependency.

## PrometheusMiddleware

Add `PrometheusMiddleware` to your queue to track per-task execution metrics:

```python
from taskito import Queue
from taskito.contrib.prometheus import PrometheusMiddleware

queue = Queue(db_path="myapp.db", middleware=[PrometheusMiddleware()])
```

### Configuration

```python
PrometheusMiddleware(
    namespace="myapp",
    extra_labels_fn=lambda ctx: {"env": "prod", "region": "us-east-1"},
    disabled_metrics={"resource", "proxy"},
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `namespace` | `str` | `"taskito"` | Prefix for all metric names. |
| `extra_labels_fn` | `Callable[[JobContext], dict[str, str]] | None` | `None` | Returns extra labels to add to job metrics. Receives `JobContext`. |
| `disabled_metrics` | `set[str] | None` | `None` | Metric groups or individual names to skip. Groups: `"jobs"`, `"queue"`, `"resource"`, `"proxy"`, `"intercept"`. |

### Metrics Tracked

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `taskito_jobs_total` | Counter | `task`, `status` | Total jobs processed (status: `completed` or `failed`) |
| `taskito_job_duration_seconds` | Histogram | `task` | Job execution duration |
| `taskito_active_workers` | Gauge | — | Number of currently executing workers |
| `taskito_retries_total` | Counter | `task` | Total retry attempts |

## PrometheusStatsCollector

For queue-level metrics, use the stats collector. It polls `queue.stats()` on a background thread:

```python
from taskito.contrib.prometheus import PrometheusStatsCollector

collector = PrometheusStatsCollector(queue, interval=10)
collector.start()
```

### Configuration

```python
PrometheusStatsCollector(
    queue,
    interval=10,
    namespace="myapp",
    disabled_metrics={"intercept"},
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `queue` | `Queue` | — | The Queue instance to poll. |
| `interval` | `float` | `10.0` | Seconds between polls. |
| `namespace` | `str` | `"taskito"` | Prefix for metric names. Must match `PrometheusMiddleware` namespace to share metric objects. |
| `disabled_metrics` | `set[str] | None` | `None` | Metric groups or names to skip. Same groups as `PrometheusMiddleware`. |

### Metrics Tracked

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `taskito_queue_depth` | Gauge | `queue` | Number of pending jobs |
| `taskito_dlq_size` | Gauge | — | Number of dead-letter jobs |
| `taskito_worker_utilization` | Gauge | — | Ratio of running jobs to total workers (0.0–1.0) |

## Metrics Server

Start a standalone `/metrics` endpoint for Prometheus to scrape:

```python
from taskito.contrib.prometheus import start_metrics_server

start_metrics_server(port=9090)
```

This uses `prometheus_client.start_http_server` under the hood.

## Full Example

```python
from taskito import Queue
from taskito.contrib.prometheus import (
    PrometheusMiddleware,
    PrometheusStatsCollector,
    start_metrics_server,
)

queue = Queue(db_path="myapp.db", middleware=[PrometheusMiddleware()])

# Start metrics endpoint
start_metrics_server(port=9090)

# Start queue stats polling
collector = PrometheusStatsCollector(queue, interval=10)
collector.start()
```

Prometheus scrape config:

```yaml
scrape_configs:
  - job_name: taskito
    static_configs:
      - targets: ["localhost:9090"]
```

## Grafana Dashboard Tips

Useful panels for a taskito Grafana dashboard:

- **Throughput** — `rate(taskito_jobs_total[5m])` by `task` and `status`
- **Duration p95** — `histogram_quantile(0.95, rate(taskito_job_duration_seconds_bucket[5m]))`
- **Queue depth** — `taskito_queue_depth` by `queue`
- **DLQ size** — `taskito_dlq_size` with alert threshold
- **Worker utilization** — `taskito_worker_utilization` as a gauge

## Combining with Other Middleware

`PrometheusMiddleware` composes with other middleware:

```python
from taskito.contrib.otel import OpenTelemetryMiddleware
from taskito.contrib.sentry import SentryMiddleware

queue = Queue(
    db_path="myapp.db",
    middleware=[
        OpenTelemetryMiddleware(),
        PrometheusMiddleware(),
        SentryMiddleware(),
    ],
)
```

See the [Middleware guide](../guide/extensibility/middleware.md) for more on combining middleware.

## Example: Alert on High DLQ Size

```python
from taskito.contrib.prometheus import PrometheusMiddleware, PrometheusStatsCollector, start_metrics_server

queue = Queue(db_path="myapp.db", middleware=[PrometheusMiddleware()])

# Start metrics and collector
start_metrics_server(port=9090)
PrometheusStatsCollector(queue, interval=10).start()
```

Prometheus alerting rule:

```yaml
groups:
  - name: taskito
    rules:
      - alert: HighDLQSize
        expr: taskito_dlq_size > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "taskito dead letter queue has {{ $value }} entries"
      - alert: HighErrorRate
        expr: rate(taskito_jobs_total{status="failed"}[5m]) > 0.1
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "High task failure rate: {{ $value }} failures/sec"
```
