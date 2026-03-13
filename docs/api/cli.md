# CLI Reference

taskito provides a command-line interface for running workers and inspecting queue state.

## Installation

The CLI is installed automatically with the package:

```bash
pip install taskito
```

The `taskito` command becomes available in your `PATH`.

## Commands

### `taskito worker`

Start a worker process that consumes and executes tasks.

```bash
taskito worker --app <module:attribute> [--queues <queue1,queue2,...>]
```

| Flag | Required | Description |
|---|---|---|
| `--app` | Yes | Python path to the `Queue` instance in `module:attribute` format |
| `--queues` | No | Comma-separated list of queues to process. Default: all registered queues |

**Examples:**

```bash
# Start a worker using the queue defined in myapp/tasks.py
taskito worker --app myapp.tasks:queue

# Only process the "emails" and "reports" queues
taskito worker --app myapp.tasks:queue --queues emails,reports

# Use a nested module path
taskito worker --app myproject.workers.tasks:task_queue
```

The worker blocks until interrupted with `Ctrl+C`. It performs a graceful shutdown — in-flight tasks are allowed to complete before the process exits.

### `taskito info`

Display queue statistics.

```bash
taskito info --app <module:attribute> [--watch]
```

| Flag | Required | Description |
|---|---|---|
| `--app` | Yes | Python path to the `Queue` instance |
| `--watch` | No | Continuously refresh stats every 2 seconds |

**Examples:**

```bash
# Show stats once
taskito info --app myapp.tasks:queue
```

Output:

```
taskito queue statistics
------------------------------
  pending      12
  running      4
  completed    1847
  failed       0
  dead         2
  cancelled    0
------------------------------
  total        1865
```

```bash
# Live monitoring with throughput
taskito info --app myapp.tasks:queue --watch
```

Output (refreshes every 2s):

```
taskito queue statistics
------------------------------
  pending      3
  running      8
  completed    2104
  failed       0
  dead         2
  cancelled    0
------------------------------
  total        2117

  throughput   12.5 jobs/s

Refreshing every 2s... (Ctrl+C to stop)
```

## App Path Format

The `--app` flag uses `module:attribute` format:

```
myapp.tasks:queue
│           │
│           └── attribute name (the Queue variable)
└── Python module path (dotted, importable)
```

The module must be importable from the current working directory. If your module is in a package, make sure the package is installed or the parent directory is in `PYTHONPATH`.

**Common patterns:**

| App structure | `--app` value |
|---|---|
| `tasks.py` with `queue = Queue()` | `tasks:queue` |
| `myapp/tasks.py` with `queue = Queue()` | `myapp.tasks:queue` |
| `src/workers/q.py` with `app = Queue()` | `src.workers.q:app` |

### `taskito scaler`

Start a lightweight KEDA metrics server.

```bash
taskito scaler --app <module:attribute> [--host <addr>] [--port <port>] [--target-queue-depth <n>]
```

| Flag | Default | Description |
|---|---|---|
| `--app` | — | Python path to the `Queue` instance |
| `--host` | `0.0.0.0` | Bind address |
| `--port` | `9091` | Bind port |
| `--target-queue-depth` | `10` | Scaling target hint returned to KEDA in `/api/scaler` responses |

The server exposes three routes:

| Route | Description |
|---|---|
| `GET /api/scaler` | Queue depth and target for KEDA `metrics-api` trigger. Add `?queue=<name>` to filter. |
| `GET /metrics` | Prometheus text format (requires `prometheus-client`). |
| `GET /health` | Liveness probe — always returns `{"status": "ok"}`. |

**Example:**

```bash
taskito scaler --app myapp:queue --port 9091 --target-queue-depth 5
```

See the [KEDA Integration guide](../guide/keda.md) for Kubernetes deploy templates.

## Error Messages

| Error | Cause |
|---|---|
| `--app must be in 'module:attribute' format` | Missing `:` separator |
| `could not import module '...'` | Module not found or import error |
| `module '...' has no attribute '...'` | Attribute doesn't exist on the module |
| `'...' is not a Queue instance` | The attribute exists but isn't a `Queue` |
