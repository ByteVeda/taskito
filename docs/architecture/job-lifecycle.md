# Job Lifecycle

Every job moves through a state machine from creation to completion (or death).

```mermaid
stateDiagram-v2
    [*] --> Pending: enqueue() / delay()
    Pending --> Running: dequeued by scheduler
    Pending --> Cancelled: cancel_job()
    Running --> Complete: task returns successfully
    Running --> Failed: task raises exception
    Failed --> Pending: retry (count < max_retries)\nwith exponential backoff
    Failed --> Dead: retries exhausted\nmoved to DLQ
    Dead --> Pending: retry_dead()
    Complete --> [*]
    Cancelled --> [*]
    Dead --> [*]: purge_dead()
```

## Status codes

| Status | Integer | Description |
|---|---|---|
| Pending | 0 | Waiting to be picked up |
| Running | 1 | Currently executing |
| Complete | 2 | Finished successfully |
| Failed | 3 | Last attempt failed (may retry) |
| Dead | 4 | All retries exhausted, in DLQ |
| Cancelled | 5 | Cancelled before execution |
