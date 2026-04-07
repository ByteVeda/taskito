# Unique Tasks

Deduplicate active jobs by key — if a job with the same `unique_key` is already pending or running, the existing job is returned instead of creating a new one:

```python
job1 = process.apply_async(args=("report",), unique_key="daily-report")
job2 = process.apply_async(args=("report",), unique_key="daily-report")
assert job1.id == job2.id  # Same job, not duplicated
```

Once the original job completes (or fails to DLQ), the key is released and a new job can be created with the same key.

!!! info "Implementation"
    Deduplication uses a partial unique index: `CREATE UNIQUE INDEX ... ON jobs(unique_key) WHERE unique_key IS NOT NULL AND status IN (0, 1)`. Only pending and running jobs participate. The check-and-insert is atomic (transaction-protected), so concurrent calls with the same `unique_key` are handled gracefully without race conditions.
