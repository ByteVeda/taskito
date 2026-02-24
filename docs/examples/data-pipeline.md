# Example: ETL Data Pipeline

A multi-stage extract → transform → load pipeline demonstrating task dependencies, DAG workflows, progress tracking, error history inspection, metadata, and named queues.

## Project Structure

```
data-pipeline/
  pipeline.py   # Task definitions + DAG construction
  worker.py     # Worker entry point
  monitor.py    # Status monitoring script
```

## pipeline.py

```python
"""ETL pipeline with task dependencies and named queues."""

import json
import time

from taskito import Queue, current_job

queue = Queue(
    db_path=".taskito/pipeline.db",
    workers=6,
    default_retry=3,
    default_timeout=120,
)

# ── Extract Tasks ────────────────────────────────────────

@queue.task(queue="extract", max_retries=5, retry_backoff=2.0)
def extract_api(endpoint: str) -> list[dict]:
    """Pull records from an API endpoint with retries."""
    # Simulate API call
    time.sleep(1)
    return [{"id": i, "value": f"record_{i}"} for i in range(100)]

@queue.task(queue="extract")
def extract_csv(file_path: str) -> list[dict]:
    """Read records from a CSV file."""
    time.sleep(0.5)
    return [{"id": i, "row": f"csv_row_{i}"} for i in range(200)]

# ── Transform Tasks ──────────────────────────────────────

@queue.task(queue="transform")
def normalize(records: list[dict], schema: str) -> list[dict]:
    """Normalize records against a schema with progress tracking."""
    results = []
    for i, record in enumerate(records):
        # Simulate normalization
        results.append({**record, "schema": schema, "normalized": True})
        if (i + 1) % 50 == 0:
            current_job.update_progress(int((i + 1) / len(records) * 100))
    current_job.update_progress(100)
    return results

@queue.task(queue="transform")
def deduplicate(records: list[dict]) -> list[dict]:
    """Remove duplicate records by ID."""
    seen = set()
    unique = []
    for r in records:
        if r["id"] not in seen:
            seen.add(r["id"])
            unique.append(r)
    return unique

# ── Load Tasks ───────────────────────────────────────────

@queue.task(queue="load")
def load_to_warehouse(records: list[dict], table: str) -> dict:
    """Load records into the data warehouse."""
    time.sleep(1)
    return {"table": table, "rows_inserted": len(records)}

# ── DAG Construction ─────────────────────────────────────

def build_pipeline(api_endpoint: str, csv_path: str, target_table: str):
    """Build a diamond-shaped ETL DAG.

    extract_api ──→ normalize_a ──┐
                                   ├──→ load
    extract_csv ──→ normalize_b ──┘
    """

    # Stage 1: Extract (parallel)
    job_api = extract_api.apply_async(
        args=[api_endpoint],
        metadata=json.dumps({"source": "api", "endpoint": api_endpoint}),
    )
    job_csv = extract_csv.apply_async(
        args=[csv_path],
        metadata=json.dumps({"source": "csv", "file": csv_path}),
    )

    # Stage 2: Transform (each depends on its extract)
    job_norm_a = normalize.apply_async(
        args=[[], "schema_v2"],  # actual data passed via result
        depends_on=job_api.id,
        metadata=json.dumps({"stage": "transform", "schema": "v2"}),
    )
    job_norm_b = normalize.apply_async(
        args=[[], "schema_v2"],
        depends_on=job_csv.id,
        metadata=json.dumps({"stage": "transform", "schema": "v2"}),
    )

    # Stage 3: Load (depends on both transforms)
    job_load = load_to_warehouse.apply_async(
        args=[[], target_table],
        depends_on=[job_norm_a.id, job_norm_b.id],
        priority=10,  # high priority once unblocked
        metadata=json.dumps({"stage": "load", "table": target_table}),
    )

    return {
        "extract": [job_api, job_csv],
        "transform": [job_norm_a, job_norm_b],
        "load": job_load,
    }


if __name__ == "__main__":
    print("Building ETL pipeline...")
    jobs = build_pipeline(
        api_endpoint="https://api.example.com/records",
        csv_path="/data/export.csv",
        target_table="analytics.events",
    )

    print(f"\nDAG created:")
    print(f"  Extract:   {[j.id for j in jobs['extract']]}")
    print(f"  Transform: {[j.id for j in jobs['transform']]}")
    print(f"  Load:      {jobs['load'].id}")

    # Inspect dependency graph
    load_job = queue.get_job(jobs["load"].id)
    print(f"\nLoad depends on: {load_job.dependencies}")

    for ext_job in jobs["extract"]:
        fetched = queue.get_job(ext_job.id)
        print(f"  {ext_job.id} dependents: {fetched.dependents}")
```

## worker.py

```python
"""Start the pipeline worker."""
from pipeline import queue

if __name__ == "__main__":
    print("Starting pipeline worker (queues: extract, transform, load)...")
    queue.run_worker(queues=["extract", "transform", "load"])
```

## monitor.py

```python
"""Monitor pipeline status and inspect errors."""

import time
from pipeline import queue

def monitor(load_job_id: str):
    """Poll the pipeline until the load job completes."""
    while True:
        stats = queue.stats()
        print(f"Queue stats: {stats}")

        job = queue.get_job(load_job_id)
        if job is None:
            print("Load job not found!")
            return

        print(f"Load job status: {job.status}, progress: {job.progress}%")

        if job.status == "complete":
            print(f"\nPipeline complete! Result: {job.result(timeout=1)}")
            return

        if job.status in ("failed", "dead", "cancelled"):
            print(f"\nPipeline failed with status: {job.status}")

            # Inspect error history for all jobs
            for dep_id in job.dependencies:
                dep = queue.get_job(dep_id)
                if dep and dep.status in ("dead", "failed"):
                    errors = dep.errors
                    print(f"\n  Job {dep_id} errors:")
                    for err in errors:
                        print(f"    Attempt {err['attempt']}: {err['error']}")
                        print(f"    At: {err['failed_at']}")

            # Check dead letter queue
            dead = queue.dead_letters(limit=10)
            if dead:
                print(f"\nDead letters ({len(dead)}):")
                for d in dead:
                    print(f"  {d['id']}: {d['task_name']} — {d['error']}")
            return

        time.sleep(2)

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python monitor.py <load_job_id>")
        sys.exit(1)
    monitor(sys.argv[1])
```

## Running It

=== "Terminal 1 — Worker"

    ```bash
    python worker.py
    ```

=== "Terminal 2 — Build Pipeline"

    ```bash
    python pipeline.py
    # Copy the load job ID from the output
    ```

=== "Terminal 3 — Monitor"

    ```bash
    python monitor.py <load_job_id>
    ```

## Cascade Cancellation

If an extract job fails permanently (exhausts all retries), the entire downstream chain is automatically cancelled:

```python
# If extract_api fails after 5 retries:
#   → normalize_a is cascade cancelled
#   → load is cascade cancelled (because one dependency failed)
#   normalize_b may still complete, but load won't run
```

This prevents wasting resources on a pipeline that can't succeed.

## Key Patterns Demonstrated

| Pattern | Where |
|---|---|
| Task dependencies | `depends_on` in transform and load stages |
| Diamond DAG | Two branches converge at the load stage |
| Cascade cancel | Extract failure cancels downstream transforms and load |
| Progress tracking | `normalize` reports progress every 50 records |
| Error history | `monitor.py` inspects `job.errors` for failed jobs |
| Metadata | Each job tagged with source/stage info via `metadata` |
| Named queues | `extract`, `transform`, `load` for queue isolation |
| Priority | Load job gets `priority=10` to run first once unblocked |
| Dead letter inspection | `monitor.py` checks `queue.dead_letters()` |
