# Advanced Execution

Patterns for scaling and optimizing task execution.

| Guide | Description |
|-------|-------------|
| [Prefork Pool](prefork.md) | Process-based isolation for CPU-bound or memory-leaking tasks |
| [Native Async Tasks](async-tasks.md) | `async def` tasks with native event loop integration |
| [Result Streaming](streaming.md) | Stream partial results and progress updates in real time |
| [Dependencies](dependencies.md) | DAG-based job dependencies — run tasks in order |
| [Batch Enqueue](batch-enqueue.md) | Enqueue many jobs efficiently with `task.map()` and `enqueue_many()` |
| [Unique Tasks](unique-tasks.md) | Deduplicate active jobs with unique keys |
