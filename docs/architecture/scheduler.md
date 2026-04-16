# Scheduler

The scheduler runs in a dedicated Tokio single-threaded async runtime:

```
loop {
    sleep(50ms) or shutdown signal

    // Try to dequeue and dispatch a job
    try_dispatch()

    // Every ~100 iterations (~5s): reap timed-out jobs
    reap_stale()

    // Every ~60 iterations (~3s): check periodic tasks
    check_periodic()

    // Every ~1200 iterations (~60s): auto-cleanup old jobs
    auto_cleanup()
}
```

## Dispatch flow

1. `dequeue_from()` — atomically SELECT + UPDATE (pending → running) within a transaction
2. Check rate limit — if over limit, reschedule 1s in the future
3. Send job to worker pool via crossbeam channel
4. Worker executes task, sends result back
5. `handle_result()` — mark complete, schedule retry, or move to DLQ
