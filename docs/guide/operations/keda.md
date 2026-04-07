# KEDA Autoscaling

[KEDA](https://keda.sh) (Kubernetes Event-driven Autoscaling) can scale your taskito worker deployment up and down based on queue depth. taskito ships a dedicated scaler server that KEDA queries directly.

## Scaler Server

Start the scaler alongside your worker:

```bash
taskito scaler --app myapp:queue --port 9091
```

| Flag | Default | Description |
|---|---|---|
| `--app` | — | Python path to the `Queue` instance |
| `--host` | `0.0.0.0` | Bind address |
| `--port` | `9091` | Bind port |
| `--target-queue-depth` | `10` | Scaling target hint returned to KEDA |

The scaler exposes three endpoints:

| Endpoint | Description |
|---|---|
| `GET /api/scaler` | Returns current queue depth and scaling target for KEDA |
| `GET /metrics` | Prometheus text format (requires `prometheus-client`) |
| `GET /health` | Liveness check — always returns `{"status": "ok"}` |

### `/api/scaler` Response

```json
{
  "metricValue": 42,
  "targetValue": 10,
  "queueName": "default"
}
```

Filter to a specific queue:

```
GET /api/scaler?queue=emails
```

### Programmatic Usage

```python
from taskito.scaler import serve_scaler

serve_scaler(queue, host="0.0.0.0", port=9091, target_queue_depth=10)
```

## Kubernetes Deployment

Deploy the scaler as a separate `Deployment` and expose it as a `ClusterIP` service:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: taskito-scaler
spec:
  replicas: 1
  selector:
    matchLabels:
      app: taskito-scaler
  template:
    metadata:
      labels:
        app: taskito-scaler
    spec:
      containers:
        - name: scaler
          image: your-image:latest
          command: ["taskito", "scaler", "--app", "myapp:queue", "--port", "9091"]
          ports:
            - containerPort: 9091
---
apiVersion: v1
kind: Service
metadata:
  name: taskito-scaler
spec:
  selector:
    app: taskito-scaler
  ports:
    - port: 9091
      targetPort: 9091
```

## ScaledObject (HTTP trigger)

Scale a long-running worker `Deployment` based on pending job count:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: taskito-worker
  namespace: default
spec:
  scaleTargetRef:
    name: taskito-worker        # your worker Deployment name
  pollingInterval: 15           # seconds between KEDA polls
  cooldownPeriod: 60            # seconds before scaling to zero
  minReplicaCount: 0            # scale to zero when idle
  maxReplicaCount: 10
  triggers:
    - type: metrics-api
      metadata:
        url: "http://taskito-scaler:9091/api/scaler"
        valueLocation: "metricValue"
        targetValue: "10"
```

Filter to a specific queue name:

```yaml
        url: "http://taskito-scaler:9091/api/scaler?queue=emails"
```

## ScaledJob (Ephemeral Batch Workers)

For batch/ETL workloads, use `ScaledJob` to create short-lived Kubernetes Jobs — one pod per N pending tasks:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledJob
metadata:
  name: taskito-batch-worker
  namespace: default
spec:
  jobTargetRef:
    template:
      spec:
        containers:
          - name: taskito-worker
            image: your-image:latest
            command: ["taskito", "worker", "--app", "myapp:queue"]
        restartPolicy: Never
  pollingInterval: 15
  successfulJobsHistoryLimit: 5
  failedJobsHistoryLimit: 5
  maxReplicaCount: 20
  scalingStrategy:
    strategy: default         # or "accurate" for 1:1 job-to-pod mapping
  triggers:
    - type: metrics-api
      metadata:
        url: "http://taskito-scaler:9091/api/scaler"
        valueLocation: "metricValue"
        targetValue: "5"      # one pod per 5 pending jobs
```

## Scaling with Prometheus

If you already have Prometheus scraping your workers, you can skip the scaler server and use the Prometheus KEDA trigger directly:

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: taskito-worker-prometheus
  namespace: default
spec:
  scaleTargetRef:
    name: taskito-worker
  pollingInterval: 15
  cooldownPeriod: 60
  minReplicaCount: 0
  maxReplicaCount: 10
  triggers:
    - type: prometheus
      metadata:
        serverAddress: "http://prometheus:9090"
        metricName: taskito_queue_depth
        query: sum(taskito_queue_depth{queue="default"})
        threshold: "10"
    - type: prometheus
      metadata:
        serverAddress: "http://prometheus:9090"
        metricName: taskito_worker_utilization
        query: taskito_worker_utilization{queue="default"}
        threshold: "0.8"
```

See the [Prometheus integration](../../integrations/prometheus.md) for setting up the metrics collector.

## Deploy Templates

Ready-to-use YAML templates are included in the repository under `deploy/keda/`:

| File | Purpose |
|---|---|
| `scaled-object.yaml` | `ScaledObject` using the HTTP scaler endpoint |
| `scaled-object-prometheus.yaml` | `ScaledObject` using Prometheus metrics |
| `scaled-job.yaml` | `ScaledJob` for ephemeral batch workers |

!!! tip
    When using SQLite, all worker replicas must share the same database volume. For multi-replica Kubernetes deployments, use the [Postgres backend](postgres.md) — workers connect over the network and there's no shared-file constraint.
