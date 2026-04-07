# Deployment

This guide covers running taskito in production environments.

## SQLite File Location

Choose a persistent, backed-up location for your database:

```python
queue = Queue(db_path="/var/lib/myapp/taskito.db")
```

**Best practices:**

- Use an absolute path — relative paths depend on the working directory
- Place the database on local storage (not NFS or network mounts) — SQLite file locking doesn't work reliably over network filesystems
- Ensure the directory exists and the worker process has read/write permissions
- The database file, WAL file (`taskito.db-wal`), and shared memory file (`taskito.db-shm`) must all be on the same filesystem

## systemd Service

Create `/etc/systemd/system/taskito-worker.service`:

```ini
[Unit]
Description=taskito worker
After=network.target

[Service]
Type=simple
User=myapp
Group=myapp
WorkingDirectory=/opt/myapp
ExecStart=/opt/myapp/.venv/bin/taskito worker --app myapp:queue
Restart=always
RestartSec=5

# Graceful shutdown — taskito handles SIGINT
KillSignal=SIGINT
TimeoutStopSec=35

# Environment
Environment=PYTHONPATH=/opt/myapp

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable taskito-worker
sudo systemctl start taskito-worker

# Check logs
journalctl -u taskito-worker -f
```

!!! tip
    Set `TimeoutStopSec` to slightly longer than your longest task timeout (default graceful shutdown is 30s). This gives in-flight tasks time to complete before systemd force-kills the process.

## Docker

### Dockerfile

```dockerfile
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Store the database in a volume
VOLUME /data
ENV TASKITO_DB_PATH=/data/taskito.db

CMD ["taskito", "worker", "--app", "myapp:queue"]
```

### docker-compose.yml

```yaml
services:
  worker:
    build: .
    volumes:
      - taskito-data:/data
    stop_signal: SIGINT
    stop_grace_period: 35s

  dashboard:
    build: .
    command: taskito dashboard --app myapp:queue --host 0.0.0.0
    volumes:
      - taskito-data:/data
    ports:
      - "8080:8080"

volumes:
  taskito-data:
```

!!! warning "Shared volumes"
    The worker and dashboard must access the **same SQLite file**. In Docker, use a named volume shared between containers. Do not use bind mounts on network storage.

### Graceful Shutdown in Containers

taskito handles `SIGINT` for graceful shutdown. Configure your container orchestrator to send `SIGINT` (not `SIGTERM`):

- **Docker Compose**: `stop_signal: SIGINT`
- **Kubernetes**: Use a `preStop` hook or configure `STOPSIGNAL` in the Dockerfile:

```dockerfile
STOPSIGNAL SIGINT
```

For Kubernetes, set `terminationGracePeriodSeconds` to match your longest task timeout:

```yaml
spec:
  terminationGracePeriodSeconds: 60
  containers:
    - name: worker
      ...
```

## WAL Mode and Backups

taskito uses SQLite in WAL (Write-Ahead Logging) mode for concurrent read/write access. This affects how you back up the database.

**Do NOT** simply copy the `.db` file while the worker is running — you may get a corrupted backup if the WAL hasn't been checkpointed.

**Safe backup methods:**

```bash
# Option 1: Use sqlite3 .backup command (safe, online)
sqlite3 /var/lib/myapp/taskito.db ".backup /backups/taskito-$(date +%Y%m%d).db"

# Option 2: Use the SQLite VACUUM INTO command
sqlite3 /var/lib/myapp/taskito.db "VACUUM INTO '/backups/taskito-$(date +%Y%m%d).db';"
```

Both methods are safe while the worker is running.

## Postgres Deployment

If you're using the [Postgres backend](postgres.md), deployment is simpler in several ways:

- **No shared-file constraints** — workers connect over the network, no need for shared volumes or local storage
- **Multi-machine workers** — run workers on separate hosts against the same database
- **Standard backups** — use `pg_dump` instead of `sqlite3 .backup`

### Docker Compose with Postgres

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: taskito
      POSTGRES_PASSWORD: secret
    volumes:
      - pgdata:/var/lib/postgresql/data

  worker:
    build: .
    environment:
      TASKITO_BACKEND: postgres
      TASKITO_DB_URL: postgresql://taskito:secret@postgres:5432/myapp
    depends_on:
      - postgres
    stop_signal: SIGINT
    stop_grace_period: 35s

volumes:
  pgdata:
```

### Postgres Backups

```bash
# Dump the taskito schema
pg_dump -h localhost -U taskito -d myapp -n taskito > backup.sql

# Restore
psql -h localhost -U taskito -d myapp < backup.sql
```

See the [Postgres Backend guide](postgres.md) for full configuration details.

## Database Maintenance

### Auto-Cleanup

Set `result_ttl` to automatically purge old completed jobs:

```python
queue = Queue(
    db_path="/var/lib/myapp/taskito.db",
    result_ttl=86400,  # Purge completed/dead jobs older than 24 hours
)
```

### Manual Cleanup

```python
# Purge completed jobs older than 7 days
queue.purge_completed(older_than=604800)

# Purge dead letters older than 30 days
queue.purge_dead(older_than=2592000)
```

### Database Size

SQLite databases grow as jobs accumulate. Without cleanup, expect roughly:

- ~1 KB per job (metadata + small payloads)
- ~1-10 KB per job with large arguments or results

With `result_ttl` set, the database stays compact. You can also periodically run `VACUUM` to reclaim space:

```bash
sqlite3 /var/lib/myapp/taskito.db "VACUUM;"
```

!!! note
    `VACUUM` rewrites the entire database and requires exclusive access. Run it during low-traffic periods or during a maintenance window.

## Monitoring in Production

### Dashboard

Run the built-in dashboard alongside the worker:

```bash
taskito dashboard --app myapp:queue --host 0.0.0.0 --port 8080
```

Place it behind a reverse proxy with authentication for production use — the dashboard has no built-in auth.

### Programmatic Stats

Poll `queue.stats()` and export to your monitoring system:

```python
import time

def export_metrics():
    while True:
        stats = queue.stats()
        # Export to Prometheus, Datadog, StatsD, etc.
        gauge("taskito.pending", stats["pending"])
        gauge("taskito.running", stats["running"])
        gauge("taskito.dead", stats["dead"])
        time.sleep(15)
```

### Hooks for Alerting

```python
@queue.on_failure
def alert_on_failure(task_name, args, kwargs, error):
    # Send to PagerDuty, Slack, email, etc.
    notify(f"Task {task_name} failed: {error}")
```

### Health Check Endpoint

If you're using FastAPI:

```python
from fastapi import FastAPI
from taskito.contrib.fastapi import TaskitoRouter

app = FastAPI()
app.include_router(TaskitoRouter(queue), prefix="/tasks")

# GET /tasks/stats returns queue health
# Use this as a health check endpoint in your load balancer
```

## Multiple Workers

taskito is designed as a **single-process** task queue when using SQLite. Running multiple worker processes against the same SQLite file is possible (WAL mode allows concurrent access), but:

- Only one process can write at a time — this limits throughput
- SQLite lock contention increases with more writers
- There is no distributed coordination between workers

For most single-machine workloads, one worker process with multiple threads (the default) is sufficient:

```python
queue = Queue(
    db_path="myapp.db",
    workers=8,  # 8 OS threads in the worker pool
)
```

If you need distributed workers across multiple machines, use the [Postgres backend](postgres.md) which removes the single-writer constraint and supports multi-machine deployments. Alternatively, consider [Celery or Dramatiq](../../comparison.md).

## SQLite Scaling Limits

taskito uses SQLite as its storage backend. Understanding its limitations helps you plan for production:

**Single-writer constraint.** SQLite allows only one write transaction at a time. WAL mode lets reads proceed concurrently with writes, but all writes are serialized. This is the primary throughput ceiling.

**Expected throughput.** On modern hardware with an SSD, expect:

- **1,000–5,000 jobs/second** for enqueue + dequeue cycles (small payloads)
- Throughput decreases with larger payloads, complex queries, or spinning disks
- The connection pool size (default: 8) controls read concurrency — tune it based on your read/write ratio

**When to upgrade to Postgres:**

- You need multi-machine distributed workers
- You consistently exceed ~5,000 jobs/second sustained throughput
- Multiple processes contend heavily for writes (high lock wait times)
- You need sub-millisecond dequeue latency under high load

taskito's [Postgres backend](postgres.md) addresses all of these limitations while keeping the same API. See the [Postgres Backend guide](postgres.md) for setup instructions.

**Connection pool tuning.** The default pool size of 8 connections works well for most workloads. If you're running many concurrent readers (e.g., a dashboard alongside workers), you can increase it:

```python
# In Rust: SqliteStorage::with_pool_size("path.db", 16)
# Pool size is set at the Rust layer; the Python API uses the default (8)
```

Increasing the pool beyond ~16 typically doesn't help, since SQLite write serialization is the bottleneck.

## Sizing Your Deployment

| Throughput | Backend | Workers | Pool | Notes |
|-----------|---------|---------|------|-------|
| < 100 jobs/s | SQLite | 4 | thread | Default config works fine |
| 100–1K jobs/s | SQLite | 8–16 | thread or prefork | Increase `workers`, monitor WAL size |
| 1K–5K jobs/s | SQLite | 16 | prefork | Prefork for CPU-bound; SQLite handles this well with WAL |
| 5K–20K jobs/s | Postgres | 16–32 | prefork | Switch to Postgres for concurrent writers |
| 20K–50K jobs/s | Postgres | 32+ | prefork | Multiple worker processes, tune `pool_size` |
| > 50K jobs/s | — | — | — | Consider Celery + RabbitMQ for this scale |

!!! note
    These are rough guidelines for noop tasks. Real throughput depends on task duration, payload size, and I/O patterns. Run the [benchmark](../../examples/benchmark.md) on your hardware to get accurate numbers.

## Checklist

- [ ] Use an absolute path for `db_path`
- [ ] Place SQLite on local (not network) storage
- [ ] Set `result_ttl` to prevent unbounded database growth
- [ ] Set `timeout` on tasks to recover from worker crashes
- [ ] Configure `SIGINT` as the stop signal in your process manager
- [ ] Set up failure hooks or monitoring for alerting
- [ ] Back up the database using `sqlite3 .backup` (not file copy), or `pg_dump` for Postgres
- [ ] Place the dashboard behind a reverse proxy with authentication
