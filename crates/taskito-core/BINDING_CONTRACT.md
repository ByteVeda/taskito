# Taskito core — language binding contract

What a new language shell (Python today; Node via napi-rs, Java via UniFFI/JNI next)
must implement or call to reuse this Rust core. The core is **binding-agnostic**:
`taskito-core`, `taskito-workflows`, `taskito-mesh` carry **no** `pyo3` dependency
(enforced in CI — see [Invariant](#invariant)). The Python shell lives in
`crates/taskito-python`; study it as the reference implementation.

## Invariant
The generic crates must never depend on `pyo3` or any language runtime. CI fails if
`pyo3` appears in the normal dependency tree of `taskito-core`, `taskito-workflows`,
or `taskito-mesh` (`cargo tree` is authoritative — you cannot `use pyo3` without
depending on it). Keep Python/Node/Java specifics in the shell.

## The payload is opaque
`Job.payload` and `Job.result` are `Vec<u8>` blobs. The core **never** interprets
them. Each shell serializes args/kwargs at enqueue and deserializes them in the
worker — using whatever serializer it wants. The Python shell defaults to cloudpickle
(Python-only). **Cross-language constraint:** a job enqueued by one language and run
by another requires both sides to use the wire envelope below.

## Wire envelope (cross-SDK payloads)
A wire payload is one tag byte followed by the codec body. The tag records which
codec produced the body, so any shell can dispatch a decoder (or reject clearly)
without out-of-band configuration:

| Tag    | Body        | Cross-SDK | Notes |
|--------|-------------|-----------|-------|
| `0x00` | native      | **never** — reject with a clear error | Language-native codec (e.g. pickle). Same-language producer/consumer only. |
| `0x01` | msgpack     | optional  | Legacy tagged format; shells MAY read it, SHOULD NOT write it cross-SDK. |
| `0x02` | CBOR (RFC 8949) | **default** | The cross-SDK wire format. |
| `0x03` | reserved    | —         | Tagged JSON (not yet specified). |
| `0x04+`| reserved    | —         | Future (protobuf, …). |

Untagged payloads predate the envelope and are same-SDK legacy; a shell MUST NOT
assume any tag discipline unless the task is configured with a tagged serializer
on both sides. (Sniffing is unsafe: raw msgpack/CBOR bodies can begin with any
byte value.)

**Why CBOR over JSON**: integers survive — JS `Number` is exact only to 2^53−1
while other languages carry 64-bit/unbounded ints; CBOR bignums round-trip them
losslessly. IANA tags also round-trip datetimes (tag 0/1), decimals (tag 4), and
byte strings without a hand-rolled registry. Mature codecs exist everywhere
(`cbor2`, `cbor-x`, `jackson-dataformat-cbor`, `fxamacker/cbor`, …).

**Call body** (`Job.payload`): a 2-element CBOR array `[args, kwargs]` — `args`
an array, `kwargs` a map (empty map when the language has no keyword arguments).
Job-scoped extras belong in the `metadata`/`notes` columns, not the payload.
Convention for cross-SDK tasks: prefer a single object argument
(`args = [ {…} ]`, `kwargs = {}`) — it maps cleanly onto every language's
handler-binding model.

**Result body** (`Job.result`): a bare CBOR value (no array wrapper).

**Cross-SDK rules**:
- A shell reading tag `0x00` on a payload it did not produce MUST fail with an
  error naming the tag, not a generic decode error.
- Producer and consumer of a task MUST be configured with the same wire
  serializer; the tag is a self-check, not a negotiation mechanism.
- Delivery-side semantics (retries, DLQ, acks) are unaffected — the envelope is
  purely a payload contract.

**Test vectors** (hex, `0x02`-tagged CBOR):
- call `f(1, "a")`, no kwargs → `02 82 82 01 61 61 a0` — `[ [1, "a"], {} ]`
- result `true` → `02 f5`
- big int `2^53` → `02 1b 00 20 00 00 00 00 00 00`

## Dispatch call sequence
1. Shell constructs `Storage` (SQLite default; `postgres`/`redis` features) — `storage/traits.rs`.
2. Shell constructs `Scheduler::new(storage, queues, SchedulerConfig, namespace)` — `scheduler/mod.rs`.
3. Shell implements `WorkerDispatcher` — `worker.rs`.
4. `Scheduler.run(job_tx)` polls + claims jobs and sends each `Job` over a
   `tokio::sync::mpsc::Sender<Job>` — `scheduler/poller.rs`, `scheduler/mod.rs`.
5. `WorkerDispatcher::run(job_rx, result_tx)` receives the `Job`, deserializes
   `job.payload`, looks the task up by `job.task_name`, runs it, and sends a
   `JobResult` back over a `crossbeam_channel::Sender<JobResult>`.
6. `Scheduler.handle_result(JobResult)` records the outcome in storage and returns a
   `ResultOutcome` — `scheduler/result_handler.rs`.
7. Shell maps `ResultOutcome` to its own events/middleware (Python: `py_queue/worker.rs`).

```
Storage ─▶ Scheduler.run ──tokio::mpsc<Job>──▶ WorkerDispatcher.run
                                                     │ deserialize payload, run task
                              ◀─crossbeam<JobResult>─┘
Scheduler.handle_result ─▶ ResultOutcome ─▶ shell emits events / middleware
```

## What a shell MUST implement
### `WorkerDispatcher` — `worker.rs`
| Method | Signature | Required |
|--------|-----------|----------|
| `run` | `async fn run(&self, job_rx: tokio::sync::mpsc::Receiver<Job>, result_tx: crossbeam_channel::Sender<JobResult>)` | yes |
| `shutdown` | `fn shutdown(&self)` | yes |
| `notify_cancel` | `fn notify_cancel(&self, job_id: &str)` | optional — in-process pools may no-op; out-of-process (prefork) must deliver a side-channel signal |

Channels: inbound `tokio::sync::mpsc::Receiver<Job>` (async); outbound
`crossbeam_channel::Sender<JobResult>` (sync, cloneable).

## Types the shell produces / consumes
- **`Job`** — `job.rs`. Fields incl. `id`, `queue`, `task_name`, `payload: Vec<u8>` (opaque),
  `status`, `priority`, `retry_count`, `max_retries`, `timeout_ms`, `unique_key`,
  `metadata`, `notes`, `cancel_requested`, `namespace`. Timestamps are Unix ms.
- **`JobResult`** — `scheduler/mod.rs`. Enum: `Success { result: Option<Vec<u8>>, … }`,
  `Failure { error, retry_count, max_retries, should_retry, timed_out, … }`,
  `Cancelled { … }`. The shell builds this from task execution.
- **`ResultOutcome`** — `scheduler/mod.rs`. Enum the core returns: `Success`, `Retry`,
  `DeadLettered`, `Cancelled`. The core decides retry-vs-DLQ from the retry budget; the
  shell only dispatches events/middleware off it.
- **`SchedulerConfig`** — `scheduler/mod.rs`. Poll interval, `batch_size`, aging,
  reap/cleanup/periodic intervals, `result_ttl_ms`, DLQ auto-retry policy.

## `Storage` trait surface the shell calls — `storage/traits.rs`
Grouped by concern (enumerated, not exhaustive — read the trait):
- **Enqueue / dequeue**: `enqueue`, `enqueue_batch`, `enqueue_unique`, `dequeue`,
  `dequeue_from`, `dequeue_batch`, `dequeue_batch_from`.
- **Completion / retry**: `complete`, `retry`, `reschedule`, `get_job`, `list_jobs`.
- **Exactly-once claims**: `claim_execution`, `complete_execution`, `list_claims_by_worker`.
- **Worker lifecycle**: `register_worker`, `heartbeat`, `unregister_worker`, `reap_dead_workers`.
- **Cancellation**: `request_cancel`, `is_cancel_requested`, `mark_cancelled`.
- **Resilience**: `try_acquire_token` (rate limit), `count_running_by_task`, `stats_by_queue`.
- **Dead-letter**: `move_to_dlq`, `list_dead`, `retry_dead`.

## Lifecycle the shell drives
- **Startup**: `register_worker(worker_id, queues, …)`. Worker ID is generated by the shell.
- **Heartbeat**: call `heartbeat(worker_id, resource_health_json)` on an interval
  (Python uses a daemon thread, ~5s). `resource_health` is arbitrary JSON the core stores
  without parsing — schema is the shell's choice.
- **Shutdown**: `unregister_worker(worker_id)`.
- **Cancellation handshake**: producer calls `request_cancel(job_id)`; an in-process
  worker observes it via `is_cancel_requested(job_id)` polling, or an out-of-process
  worker via `notify_cancel`; on observe, the shell calls `mark_cancelled(job_id)`.

## Python assumptions in the core (none structural)
All clean — `payload`/`result`/`task_name` opaque, channels standard, `Storage`
fully abstract, three interchangeable backends. The only Python mentions left are
doc-comments pointing at the Python shell as the *example* binding; no code path
assumes a serializer, a runtime, or a middleware framework.
