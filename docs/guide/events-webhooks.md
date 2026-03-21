# Events & Webhooks

taskito includes an in-process event bus and webhook delivery system for reacting to job lifecycle events.

## Event Types

The `EventType` enum defines all available lifecycle events:

| Event | Fired when | Payload fields |
|-------|------------|----------------|
| `JOB_ENQUEUED` | A job is added to the queue | `job_id`, `task_name`, `queue` |
| `JOB_COMPLETED` | A job finishes successfully | `job_id`, `task_name`, `queue` |
| `JOB_FAILED` | A job raises an exception (before retry) | `job_id`, `task_name`, `queue`, `error` |
| `JOB_RETRYING` | A failed job will be retried | `job_id`, `task_name`, `error`, `retry_count` |
| `JOB_DEAD` | A job exhausts all retries and enters the DLQ | `job_id`, `task_name`, `error` |
| `JOB_CANCELLED` | A job is cancelled | `job_id`, `task_name` |
| `WORKER_STARTED` | A worker process/thread comes online | `worker_id`, `hostname` |
| `WORKER_STOPPED` | A worker process/thread shuts down | `worker_id`, `hostname` |
| `WORKER_ONLINE` | Worker registered in storage (visible to fleet) | `worker_id`, `queues`, `pool` |
| `WORKER_OFFLINE` | Dead worker reaped (no heartbeat for 30s) | `worker_id` |
| `WORKER_UNHEALTHY` | Resource health transitions to unhealthy | `worker_id`, `resources` |
| `QUEUE_PAUSED` | A named queue is paused | `queue` |
| `QUEUE_RESUMED` | A paused queue is resumed | `queue` |

`JOB_RETRYING`, `JOB_DEAD`, and `JOB_CANCELLED` are emitted by the Rust result handler immediately after the scheduler records the outcome. Middleware hooks (`on_retry`, `on_dead_letter`, `on_cancel`) are called in the same result-handling pass, after the event fires.

`QUEUE_PAUSED` and `QUEUE_RESUMED` are emitted synchronously by `queue.pause()` and `queue.resume()` after the queue state is written to storage.

## Registering Listeners

Use `queue.on_event()` to subscribe a callback to a specific event type:

```python
from taskito import Queue
from taskito.events import EventType

queue = Queue(db_path="tasks.db")

def on_failure(event_type: EventType, payload: dict):
    print(f"Job {payload['job_id']} failed: {payload.get('error')}")

queue.on_event(EventType.JOB_FAILED, on_failure)
```

### Callback Signature

All callbacks receive two arguments:

- `event_type` (`EventType`) — the event that occurred
- `payload` (`dict`) — event details including `job_id`, `task_name`, `queue`, and event-specific fields

### Async Delivery

Callbacks are dispatched asynchronously in a `ThreadPoolExecutor`. The thread pool size defaults to 4 and can be configured via `Queue(event_workers=N)`. This means:

- Callbacks never block the worker
- Exceptions in callbacks are logged but do not affect job processing
- Callbacks may execute slightly after the event occurs

## Webhooks

For external systems, register webhook URLs to receive HTTP POST requests on job events.

### Registering a Webhook

```python
queue.add_webhook(
    url="https://example.com/hooks/taskito",
    events=[EventType.JOB_FAILED, EventType.JOB_DEAD],
    headers={"Authorization": "Bearer mytoken"},
    secret="my-signing-secret",
)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | `str` | — | URL to POST event payloads to (must be `http://` or `https://`) |
| `events` | `list[EventType] \| None` | `None` | Event types to subscribe to. `None` means all events |
| `headers` | `dict[str, str] \| None` | `None` | Extra HTTP headers to include in requests |
| `secret` | `str \| None` | `None` | HMAC-SHA256 signing secret |
| `max_retries` | `int` | `3` | Maximum delivery attempts |
| `timeout` | `float` | `10.0` | HTTP request timeout in seconds |
| `retry_backoff` | `float` | `2.0` | Base for exponential backoff between retries |

### HMAC Signing

When a `secret` is provided, each webhook request includes an `X-Taskito-Signature` header:

```
X-Taskito-Signature: sha256=<hex digest>
```

The signature is computed over the JSON request body using HMAC-SHA256. Verify it on the receiving end:

```python
import hashlib
import hmac

def verify_signature(body: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)
```

### Retry Behavior

Failed webhook deliveries are retried with exponential backoff. The number of attempts, request timeout, and backoff base are configurable per webhook via `max_retries`, `timeout`, and `retry_backoff`. With the defaults (`max_retries=3`, `retry_backoff=2.0`):

| Attempt | Delay before next retry |
|---------|------------------------|
| 1st retry | 1 second (`2.0 ** 0`) |
| 2nd retry | 2 seconds (`2.0 ** 1`) |
| 3rd retry | — (final) |

4xx responses are not retried. If all attempts fail, a warning is logged and the event is dropped.

### Event Filtering

Subscribe to specific events or all events:

```python
# Only failure events
queue.add_webhook(
    url="https://slack.example.com/webhook",
    events=[EventType.JOB_FAILED, EventType.JOB_DEAD],
)

# All events
queue.add_webhook(url="https://monitoring.example.com/events")
```

## Examples

### Slack Notification on Job Failure

```python
import requests
from taskito.events import EventType

def notify_slack(event_type: EventType, payload: dict):
    requests.post(
        "https://hooks.slack.com/services/T.../B.../xxx",
        json={
            "text": f":x: Task `{payload['task_name']}` failed\n"
                    f"Job ID: `{payload['job_id']}`\n"
                    f"Error: {payload.get('error', 'unknown')}"
        },
    )

queue.on_event(EventType.JOB_FAILED, notify_slack)
queue.on_event(EventType.JOB_DEAD, notify_slack)
```

### Webhook to External Monitoring

```python
queue.add_webhook(
    url="https://monitoring.example.com/api/taskito-events",
    events=[EventType.JOB_COMPLETED, EventType.JOB_FAILED, EventType.JOB_DEAD],
    secret="whsec_abc123",
    headers={"X-Source": "taskito-prod"},
)
```

The monitoring service receives JSON payloads like:

```json
{
    "event": "job.failed",
    "job_id": "01H5K6X...",
    "task_name": "myapp.tasks.process",
    "queue": "default",
    "error": "ConnectionError: ..."
}
```

### Job Completion Tracking

```python
from taskito.events import EventType

completed_count = 0

def track_completion(event_type: EventType, payload: dict):
    global completed_count
    completed_count += 1
    if completed_count % 100 == 0:
        print(f"Milestone: {completed_count} jobs completed")

queue.on_event(EventType.JOB_COMPLETED, track_completion)
```

### Database Logging for Audit Trail

```python
from taskito.events import EventType

def audit_log(event_type: EventType, payload: dict):
    db.execute(
        "INSERT INTO audit_log (event, job_id, task_name, timestamp) VALUES (?, ?, ?, ?)",
        (event_type.value, payload["job_id"], payload["task_name"], time.time()),
    )

# Subscribe to all important events
for event in [EventType.JOB_ENQUEUED, EventType.JOB_COMPLETED, EventType.JOB_FAILED, EventType.JOB_DEAD]:
    queue.on_event(event, audit_log)
```

### Webhook Receiver (Flask)

A minimal Flask app that receives and verifies taskito webhooks:

```python
from flask import Flask, request, abort
import hashlib, hmac

app = Flask(__name__)
WEBHOOK_SECRET = "my-signing-secret"

@app.route("/hooks/taskito", methods=["POST"])
def receive_webhook():
    signature = request.headers.get("X-Taskito-Signature", "")
    expected = hmac.new(
        WEBHOOK_SECRET.encode(), request.data, hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(f"sha256={expected}", signature):
        abort(401)

    event = request.json
    print(f"Received event: {event['event']} for job {event['job_id']}")
    return "", 204
```
