# API Reference

Complete Python API reference for all public classes and methods.

| Class | Description |
|-------|-------------|
| [Queue](queue/index.md) | Central orchestrator — task registration, enqueue, workers, and all queue operations |
| [TaskWrapper](task.md) | Handle returned by `@queue.task()` — `delay()`, `apply_async()`, `map()`, signatures |
| [JobResult](result.md) | Handle for an enqueued job — status polling, result retrieval, dependencies |
| [JobContext](context.md) | Runtime context inside a running task — job ID, retry count, progress updates |
| [Canvas](canvas.md) | Workflow primitives — `Signature`, `chain`, `group`, `chord` |
| [Testing](testing.md) | Test mode, `TestResult`, `MockResource` for unit testing tasks |
| [CLI](cli.md) | `taskito` command-line interface — `worker`, `info`, `scaler` |
