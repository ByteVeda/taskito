# Worker Pool

The worker pool dispatches jobs from the scheduler to Python task functions.

```mermaid
flowchart TD
    SCH["Scheduler\nTokio async · 50ms poll"]

    SCH -->|"sync job"| JCH["Job Channel\nbounded: workers×2"]
    SCH -->|"async job"| AP["Native Async Pool"]

    JCH --> WP["Worker Threads\nGIL per task · N threads"]
    AP --> EL["Async Executor\ndedicated event loop"]

    WP -->|"Result"| RCH["Result Channel"]
    EL -->|"PyResultSender"| RCH

    RCH --> ML["Main Loop\npy.allow_threads"]
    ML -->|"complete / retry / DLQ"| DB[("SQLite")]
```

## Design decisions

- **OS threads, not Python threads**: Sync workers are Rust `std::thread` threads. The GIL is only acquired when calling Python task code.
- **Bounded channels**: Both job and result channels are bounded to `workers × 2` to provide backpressure.
- **GIL isolation**: Each sync worker acquires the GIL independently using `Python::with_gil()`. The scheduler and result handler release the GIL via `py.allow_threads()`.
- **Native async dispatch**: `async def` tasks bypass the thread pool entirely. A `NativeAsyncPool` sends them to a dedicated `AsyncTaskExecutor` running on a Python daemon thread. `PyResultSender` (a `#[pyclass]`) bridges results back into the Rust scheduler.
- **Context isolation**: Sync tasks use `threading.local` for `current_job`; async tasks use `contextvars.ContextVar`, which is properly scoped across `await` boundaries and isolated between concurrent coroutines.
