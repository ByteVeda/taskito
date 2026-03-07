# Flask Integration

taskito provides a first-class Flask extension that configures a `Queue` from your app config and registers CLI commands.

## Installation

```bash
pip install taskito[flask]
```

## Basic Setup

```python
from flask import Flask
from taskito.contrib.flask import Taskito

app = Flask(__name__)
app.config["TASKITO_DB_PATH"] = "myapp.db"

taskito = Taskito(app)

@taskito.queue.task()
def send_email(to: str, subject: str):
    ...
```

## Factory Pattern

```python
from taskito.contrib.flask import Taskito

taskito = Taskito()

def create_app():
    app = Flask(__name__)
    app.config["TASKITO_DB_PATH"] = "myapp.db"
    taskito.init_app(app)
    return app
```

## Configuration

All configuration is read from `app.config`:

| Config Key | Default | Description |
|------------|---------|-------------|
| `TASKITO_DB_PATH` | `.taskito/taskito.db` | SQLite database path |
| `TASKITO_BACKEND` | `"sqlite"` | Storage backend: `"sqlite"` or `"postgres"` |
| `TASKITO_DB_URL` | `None` | PostgreSQL connection URL (when backend is `"postgres"`) |
| `TASKITO_WORKERS` | `0` (auto) | Number of worker threads |
| `TASKITO_SCHEMA` | `"taskito"` | PostgreSQL schema name |
| `TASKITO_DEFAULT_RETRY` | `3` | Default retry count for tasks |
| `TASKITO_DEFAULT_TIMEOUT` | `300` | Default timeout in seconds |
| `TASKITO_DEFAULT_PRIORITY` | `0` | Default task priority |
| `TASKITO_RESULT_TTL` | `None` | Auto-purge completed jobs after N seconds |
| `TASKITO_DRAIN_TIMEOUT` | `30` | Seconds to wait for running tasks on shutdown |

## CLI Commands

The extension registers commands under the `flask taskito` group:

### `flask taskito worker`

Start a taskito worker:

```bash
flask taskito worker
flask taskito worker --queues default,emails
```

### `flask taskito info`

Show queue statistics:

```bash
flask taskito info
```

```
taskito queue statistics
------------------------------
  pending      12
  running      3
  completed    450
  failed       2
  dead         1
  cancelled    0
------------------------------
  total        468
```

## Accessing the Queue

```python
# Via the extension instance
taskito.queue.stats()

# Via app extensions
app.extensions["taskito"].queue.stats()
```

## Full Example

A complete Flask application with task definitions and routes:

```python
from flask import Flask, jsonify, request
from taskito.contrib.flask import Taskito

app = Flask(__name__)
app.config["TASKITO_DB_PATH"] = "myapp.db"
app.config["TASKITO_DEFAULT_RETRY"] = 3
app.config["TASKITO_RESULT_TTL"] = 86400  # 24h auto-cleanup

taskito = Taskito(app)

@taskito.queue.task()
def send_welcome_email(user_id: int):
    """Send a welcome email to a new user."""
    user = get_user(user_id)
    send_email(user.email, "Welcome!", "Thanks for signing up.")

@taskito.queue.task(rate_limit="10/m")
def generate_report(report_type: str, params: dict):
    """Generate a report (rate-limited to 10/minute)."""
    return create_report(report_type, params)

@app.route("/api/users", methods=["POST"])
def create_user():
    user = create_user_in_db(request.json)
    send_welcome_email.delay(user.id)
    return jsonify({"id": user.id}), 201

@app.route("/api/reports", methods=["POST"])
def request_report():
    job = generate_report.delay(
        request.json["type"],
        request.json.get("params", {}),
    )
    return jsonify({"job_id": job.id}), 202

@app.route("/api/reports/<job_id>")
def report_status(job_id: str):
    job = taskito.queue.get_job(job_id)
    if job is None:
        return jsonify({"error": "Not found"}), 404
    return jsonify({"status": job.status, "progress": job.progress})

@app.route("/api/queue/stats")
def queue_stats():
    return jsonify(taskito.queue.stats())
```

Run the app and worker:

```bash
# Terminal 1: Flask app
flask run

# Terminal 2: Worker
flask taskito worker
```
