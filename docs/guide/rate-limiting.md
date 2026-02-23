# Rate Limiting

quickq uses a **token bucket** algorithm to limit how fast tasks execute. Rate limits are per-task and persisted in SQLite.

## Usage

```python
@queue.task(rate_limit="100/m")  # 100 per minute
def send_email(to, subject, body):
    ...

@queue.task(rate_limit="10/s")   # 10 per second
def api_call(endpoint):
    ...

@queue.task(rate_limit="3600/h") # 3600 per hour
def generate_report(report_id):
    ...
```

## Syntax

Rate limits use the format `count/period`:

| Format | Meaning |
|---|---|
| `"10/s"` | 10 per second |
| `"100/m"` | 100 per minute |
| `"3600/h"` | 3600 per hour |

## How It Works

The token bucket algorithm:

1. Each task name has a bucket with `max_tokens = count` and a `refill_rate = count / period`
2. Before dispatching a job, the scheduler checks if a token is available
3. If a token is available, it's consumed and the job is dispatched
4. If no tokens are available, the job is **rescheduled** 1 second in the future

!!! info "Rate limit state is persisted"
    Token bucket state (current tokens, last refill time) is stored in the `rate_limits` SQLite table. This means rate limits survive worker restarts.

## Per-Task, Not Per-Queue

Rate limits apply to the **task name**, regardless of which queue the job is in:

```python
@queue.task(rate_limit="10/s", queue="emails")
def send_email(to, subject, body):
    ...

# Both of these are rate-limited together (same task name)
send_email.delay("alice@example.com", "Hi", "Body")
send_email.apply_async(args=("bob@example.com", "Hi", "Body"), queue="urgent")
```

## Combining with Retries

Rate limiting and retries work together seamlessly. If a rate-limited task fails and retries, the retry attempt is also subject to the rate limit:

```python
@queue.task(rate_limit="5/s", max_retries=3, retry_backoff=2.0)
def external_api(url):
    response = requests.get(url)
    response.raise_for_status()
    return response.json()
```
