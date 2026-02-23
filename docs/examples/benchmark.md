# Example: Benchmark

Measure taskito's throughput by enqueuing and processing a large batch of tasks.

## benchmark.py

```python
"""taskito throughput benchmark.

Measures:
1. Enqueue throughput (jobs/sec) using batch insert
2. Processing throughput (jobs/sec) with N workers
3. End-to-end latency
"""

import os
import threading
import time

from taskito import Queue

# ── Configuration ────────────────────────────────────────

NUM_JOBS = 10_000
NUM_WORKERS = os.cpu_count() or 4
DB_PATH = ":memory:"  # In-memory for pure speed test

queue = Queue(db_path=DB_PATH, workers=NUM_WORKERS)

@queue.task()
def noop(x):
    """Minimal task — measures framework overhead."""
    return x

@queue.task()
def cpu_light(x):
    """Light CPU work — string formatting."""
    return f"processed-{x}-{'x' * 100}"

# ── Benchmark Functions ──────────────────────────────────

def bench_enqueue(task, n):
    """Measure batch enqueue throughput."""
    args_list = [(i,) for i in range(n)]

    start = time.perf_counter()
    jobs = task.map(args_list)
    elapsed = time.perf_counter() - start

    rate = n / elapsed
    print(f"  Enqueued {n:,} jobs in {elapsed:.2f}s ({rate:,.0f} jobs/s)")
    return jobs

def bench_process(jobs, timeout=120):
    """Measure processing throughput by waiting for all jobs."""
    n = len(jobs)
    start = time.perf_counter()

    # Wait for the last job (highest ID, enqueued last)
    # With FIFO ordering, this means all jobs are done
    last = jobs[-1]
    try:
        last.result(timeout=timeout, poll_interval=0.01, max_poll_interval=0.1)
    except TimeoutError:
        stats = queue.stats()
        print(f"  Timed out! Stats: {stats}")
        return

    elapsed = time.perf_counter() - start
    rate = n / elapsed
    print(f"  Processed {n:,} jobs in {elapsed:.2f}s ({rate:,.0f} jobs/s)")

def bench_latency(task, samples=100):
    """Measure single-job round-trip latency."""
    latencies = []
    for i in range(samples):
        start = time.perf_counter()
        job = task.delay(i)
        job.result(timeout=10)
        latencies.append(time.perf_counter() - start)

    avg = sum(latencies) / len(latencies)
    p50 = sorted(latencies)[len(latencies) // 2]
    p99 = sorted(latencies)[int(len(latencies) * 0.99)]
    print(f"  Latency (n={samples}): avg={avg*1000:.1f}ms p50={p50*1000:.1f}ms p99={p99*1000:.1f}ms")

# ── Main ─────────────────────────────────────────────────

def main():
    print(f"taskito benchmark")
    print(f"  Workers: {NUM_WORKERS}")
    print(f"  Jobs:    {NUM_JOBS:,}")
    print(f"  DB:      {DB_PATH}")
    print()

    # Start worker in background
    worker_thread = threading.Thread(target=queue.run_worker, daemon=True)
    worker_thread.start()
    time.sleep(0.5)  # Let worker initialize

    # 1. Noop throughput
    print("── noop task (framework overhead) ──")
    jobs = bench_enqueue(noop, NUM_JOBS)
    bench_process(jobs)
    print()

    # 2. Light CPU task throughput
    print("── cpu_light task ──")
    jobs = bench_enqueue(cpu_light, NUM_JOBS)
    bench_process(jobs)
    print()

    # 3. Single-job latency
    print("── single-job latency ──")
    bench_latency(noop)
    print()

    # Final stats
    stats = queue.stats()
    print(f"Final stats: {stats}")

if __name__ == "__main__":
    main()
```

## Running

```bash
python benchmark.py
```

## Sample Output

```
taskito benchmark
  Workers: 8
  Jobs:    10,000
  DB:      :memory:

── noop task (framework overhead) ──
  Enqueued 10,000 jobs in 0.18s (55,556 jobs/s)
  Processed 10,000 jobs in 2.41s (4,149 jobs/s)

── cpu_light task ──
  Enqueued 10,000 jobs in 0.19s (52,632 jobs/s)
  Processed 10,000 jobs in 2.53s (3,953 jobs/s)

── single-job latency ──
  Latency (n=100): avg=1.2ms p50=1.1ms p99=3.4ms

Final stats: {'pending': 0, 'running': 0, 'completed': 20100, 'failed': 0, 'dead': 0, 'cancelled': 0}
```

!!! note
    Actual numbers depend on your hardware, Python version, and SQLite configuration. The numbers above are from an 8-core machine with Python 3.12.

## What Makes taskito Fast

| Component | How it helps |
|---|---|
| **Batch inserts** | `task.map()` inserts all jobs in a single SQLite transaction |
| **WAL mode** | Concurrent reads while writing — workers don't block enqueue |
| **Rust scheduler** | 50ms poll loop runs in native code, not Python |
| **OS threads** | Workers are Rust `std::thread`, not Python threads |
| **GIL per task** | GIL acquired only during Python task execution, released between tasks |
| **crossbeam channels** | Lock-free job dispatch to workers |
| **r2d2 pool** | Up to 8 concurrent SQLite connections |
| **Diesel ORM** | Compiled SQL queries, no runtime query building |

## Tuning

Adjust these for your workload:

```python
# More workers for I/O-bound tasks
queue = Queue(workers=16)

# Fewer workers for CPU-bound tasks (limited by GIL)
queue = Queue(workers=4)

# In-memory DB for maximum throughput (no persistence)
queue = Queue(db_path=":memory:")

# File DB for durability (slightly slower)
queue = Queue(db_path="tasks.db")
```
