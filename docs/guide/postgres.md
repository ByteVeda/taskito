# Postgres Backend

taskito supports PostgreSQL as an alternative storage backend for production deployments that need multi-machine workers or higher write throughput.

## When to Use Postgres

Choose Postgres over the default SQLite backend when you need:

- **Multi-machine workers** — run workers on separate hosts against a shared database
- **Higher write throughput** — Postgres handles concurrent writes without SQLite's single-writer constraint
- **Existing Postgres infrastructure** — reuse your existing database server instead of managing SQLite files

For single-machine workloads, SQLite remains the simpler choice — no external dependencies required.

## Installation

```bash
pip install taskito[postgres]
```

!!! warning "Linux only"
    The Postgres backend currently requires Linux. macOS and Windows are not yet supported for the `postgres` extra.

## Configuration

```python
from taskito import Queue

queue = Queue(
    backend="postgres",
    db_url="postgresql://user:password@localhost:5432/myapp",
    schema="taskito",  # optional, default: "taskito"
)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `backend` | `str` | `"sqlite"` | Set to `"postgres"` or `"postgresql"` |
| `db_url` | `str` | `None` | PostgreSQL connection URL (required for Postgres) |
| `schema` | `str` | `"taskito"` | PostgreSQL schema for all tables |
| `workers` | `int` | `0` (auto) | Number of worker threads |

All other `Queue` parameters (`default_retry`, `default_timeout`, `default_priority`, `result_ttl`) work identically to the SQLite backend.

## Django Integration

Configure the Postgres backend via Django settings:

```python
# settings.py
TASKITO_BACKEND = "postgres"
TASKITO_DB_URL = "postgresql://user:password@localhost:5432/myapp"
TASKITO_SCHEMA = "taskito"
```

Then use the Django integration as normal:

```python
from taskito.contrib.django.settings import get_queue

queue = get_queue()
```

All Django settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `TASKITO_BACKEND` | `"sqlite"` | Storage backend (`"sqlite"` or `"postgres"`) |
| `TASKITO_DB_URL` | `None` | PostgreSQL connection URL |
| `TASKITO_SCHEMA` | `"taskito"` | PostgreSQL schema name |
| `TASKITO_DB_PATH` | `".taskito/taskito.db"` | SQLite database path (ignored with Postgres) |
| `TASKITO_WORKERS` | `0` | Worker thread count (0 = auto-detect) |
| `TASKITO_DEFAULT_RETRY` | `3` | Default max retries |
| `TASKITO_DEFAULT_TIMEOUT` | `300` | Default task timeout in seconds |
| `TASKITO_DEFAULT_PRIORITY` | `0` | Default task priority |
| `TASKITO_RESULT_TTL` | `None` | Result TTL in seconds |

## Schema Isolation

taskito creates all tables inside a dedicated PostgreSQL schema (default: `taskito`). The schema is created automatically if it doesn't exist.

```python
# Use a custom schema
queue = Queue(backend="postgres", db_url="postgresql://...", schema="myapp_tasks")
```

Schema names must contain only alphanumeric characters and underscores. Invalid names raise a `ConfigError` at startup.

This lets you run multiple independent taskito instances in the same database by using different schemas, or keep taskito tables separate from your application tables.

## Connection Pooling

The Postgres backend uses Diesel's `r2d2` connection pool with a default size of **10 connections**. Each connection has the `search_path` set to the configured schema on acquisition.

The pool size is configured at the Rust layer. For most workloads, the default of 10 connections is sufficient.

## Migrations

Migrations run automatically on first connection. taskito creates the following **11 tables** inside the configured schema:

| Table | Purpose |
|-------|---------|
| `jobs` | Core job storage |
| `dead_letter` | Dead letter queue |
| `rate_limits` | Token bucket rate limiting state |
| `periodic_tasks` | Cron-scheduled task definitions |
| `job_errors` | Per-attempt error tracking |
| `job_dependencies` | Task dependency edges |
| `task_metrics` | Execution time and memory metrics |
| `replay_history` | Job replay audit trail |
| `task_logs` | Structured task log entries |
| `circuit_breakers` | Circuit breaker state |
| `workers` | Worker heartbeat tracking |

All tables use PostgreSQL-native types (`TEXT`, `BYTEA`, `BIGINT`, `BOOLEAN`, `DOUBLE PRECISION`) rather than SQLite-compatible types.

## Differences from SQLite

| Aspect | SQLite | Postgres |
|--------|--------|----------|
| Connection model | Embedded, file-based | Client/server, networked |
| Write concurrency | Single writer (WAL mode) | Multiple concurrent writers |
| Distribution | Single machine only | Multi-machine workers |
| Setup | Zero config, bundled | Requires Postgres server |
| Connection pool default | 8 connections | 10 connections |
| Schema isolation | N/A (file per database) | Custom PostgreSQL schema |
| Tables | 6 tables | 11 tables (additional: `job_dependencies`, `task_metrics`, `replay_history`, `task_logs`, `circuit_breakers`) |
| Backup | `sqlite3 .backup` | `pg_dump` |

## Deployment

### Docker Compose

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
    ports:
      - "5432:5432"

  worker:
    build: .
    environment:
      TASKITO_BACKEND: postgres
      TASKITO_DB_URL: postgresql://taskito:secret@postgres:5432/myapp
    depends_on:
      - postgres
    stop_signal: SIGINT
    stop_grace_period: 35s

  dashboard:
    build: .
    command: taskito dashboard --app myapp:queue --host 0.0.0.0
    environment:
      TASKITO_BACKEND: postgres
      TASKITO_DB_URL: postgresql://taskito:secret@postgres:5432/myapp
    depends_on:
      - postgres
    ports:
      - "8080:8080"

volumes:
  pgdata:
```

With Postgres, there are no shared-file constraints — workers and dashboard connect over the network. You can run multiple worker containers across different hosts.

### systemd

```ini
[Unit]
Description=taskito worker
After=network.target postgresql.service

[Service]
Type=simple
User=myapp
Group=myapp
WorkingDirectory=/opt/myapp
ExecStart=/opt/myapp/.venv/bin/taskito worker --app myapp:queue
Restart=always
RestartSec=5
KillSignal=SIGINT
TimeoutStopSec=35

Environment=PYTHONPATH=/opt/myapp
Environment=TASKITO_BACKEND=postgres
Environment=TASKITO_DB_URL=postgresql://taskito:secret@db.internal:5432/myapp

[Install]
WantedBy=multi-user.target
```

### Multi-Machine Workers

With Postgres, you can run workers on multiple machines. Each worker connects to the same database and coordinates through PostgreSQL's row-level locking:

```bash
# Machine 1
taskito worker --app myapp:queue

# Machine 2
taskito worker --app myapp:queue

# Machine 3
taskito worker --app myapp:queue
```

All workers share the same job queue and dequeue work atomically.

## Backups

Use standard PostgreSQL backup tools instead of SQLite-specific commands:

```bash
# Dump the taskito schema
pg_dump -h localhost -U taskito -d myapp -n taskito > backup.sql

# Restore
psql -h localhost -U taskito -d myapp < backup.sql
```

For continuous backups, use PostgreSQL's built-in WAL archiving or a tool like [pgBackRest](https://pgbackrest.org/).
