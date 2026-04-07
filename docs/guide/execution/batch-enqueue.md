# Batch Enqueue

Insert many jobs in a single SQLite transaction for high throughput.

## `task.map()`

```python
@queue.task()
def process(item_id):
    return fetch_and_process(item_id)

# Enqueue 1000 jobs in one transaction
jobs = process.map([(i,) for i in range(1000)])
```

## `queue.enqueue_many()`

```python
# Basic batch — same options for all jobs
jobs = queue.enqueue_many(
    task_name="myapp.process",
    args_list=[(i,) for i in range(1000)],
    priority=5,
    queue="processing",
)

# Full parity with enqueue() — per-job overrides
jobs = queue.enqueue_many(
    task_name="myapp.process",
    args_list=[(i,) for i in range(100)],
    delay=5.0,                          # uniform 5s delay for all
    unique_keys=[f"item-{i}" for i in range(100)],  # per-job dedup
    metadata='{"source": "batch"}',     # uniform metadata
    expires=3600.0,                     # expire after 1 hour
    result_ttl=600,                     # keep results for 10 minutes
)
```

Per-job lists (`delay_list`, `metadata_list`, `expires_list`, `result_ttl_list`) override uniform values when both are provided. See the [API reference](../../api/queue/index.md#queueenqueue_many) for the full parameter list.
