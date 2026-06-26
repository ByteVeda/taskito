# Taskito Java SDK

A typed Java 11+ client over the Taskito Rust core, via a hand-written JNI shell
(`crates/taskito-java`).

> Status: **build-out**. Producer + inspection + admin + logs, worker task
> execution, middleware, signed/encrypted serializers, dashboard, webhooks, CLI,
> distributed locks, periodic/cron, and static-DAG workflows are implemented and
> verified end-to-end.

## Usage

### Enqueue

```java
import org.byteveda.taskito.Queue;
import org.byteveda.taskito.Taskito;
import org.byteveda.taskito.model.Job;
import org.byteveda.taskito.model.JobStatus;
import org.byteveda.taskito.model.QueueStats;
import org.byteveda.taskito.task.EnqueueOptions;
import org.byteveda.taskito.task.Task;
import java.util.Map;

Task<Map> sendEmail = Task.of("send_email", Map.class)
        .withOptions(EnqueueOptions.builder().queue("emails").priority(5).build());

try (Queue queue = Taskito.builder().backend("sqlite").url("taskito.db").open()) {
    String id = queue.enqueue(sendEmail, Map.of("to", "a@b.c"));
    Job job = queue.getJob(id).orElseThrow();   // job.status == JobStatus.PENDING
    QueueStats stats = queue.stats();
    queue.cancel(id);
}
```

### Run a worker

```java
import org.byteveda.taskito.events.EventName;
import org.byteveda.taskito.task.Task;
import org.byteveda.taskito.worker.Worker;

Task<Map> add = Task.of("add", Map.class);

Queue queue = Taskito.builder().backend("sqlite").url("taskito.db").open();
Worker worker = queue.worker()
        .handle(add, p -> ((Number) p.get("a")).intValue() + ((Number) p.get("b")).intValue())
        .concurrency(4)
        .on(EventName.SUCCESS, e -> System.out.println("done: " + e.jobId))
        .start();

// Close on SIGTERM/Ctrl-C; awaitShutdown() then unblocks. (Don't put the worker
// in try-with-resources AND call awaitShutdown() inside it — the block can't
// exit to trigger close(), so it would deadlock.)
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    worker.close();
    queue.close();
}));
worker.awaitShutdown();
```

### Workflows

Define a DAG of tasks; steps run in topological order once every predecessor
finishes. Attach `trackWorkflows()` to the worker so node and run state advance
as jobs complete.

```java
import org.byteveda.taskito.task.Task;
import org.byteveda.taskito.worker.Worker;
import org.byteveda.taskito.workflows.Workflow;
import org.byteveda.taskito.workflows.WorkflowRun;
import org.byteveda.taskito.workflows.WorkflowStatus;

Task<Integer> extract = Task.of("extract", Integer.class);
Task<Integer> transform = Task.of("transform", Integer.class);
Task<Integer> load = Task.of("load", Integer.class);

Workflow wf = Workflow.named("etl")
        .step("extract", extract, 1)
        .step("transform", transform, 2, "extract")
        .step("load", load, 3, "transform");

WorkflowRun run = queue.submitWorkflow(wf);

try (Worker worker = queue.worker()
        .handle(extract, p -> p * 10)
        .handle(transform, p -> p + 1)
        .handle(load, p -> p)
        .trackWorkflows()
        .start()) {
    WorkflowStatus status = run.await(Duration.ofSeconds(30));
    // status.state == WorkflowState.COMPLETED; status.node("load").get().status
}
```

A failed step (after its retries) fails the run and skips downstream nodes;
`run.cancel()` skips pending nodes. Fan-out, conditions, gates, and sagas are
not yet exposed.

### Middleware

```java
queue.use(new Middleware() {
    @Override public void onEnqueue(EnqueueContext ctx) { /* validate / rewrite */ }
    @Override public void before(TaskContext ctx) { /* trace */ }
    @Override public void onDeadLetter(OutcomeEvent e) { /* alert */ }
});
```

### Dashboard

```java
try (DashboardServer dashboard = DashboardServer.start(queue, 8080, token, staticDir)) {
    // GET /api/stats, /api/jobs, /api/workers, ... ; POST /api/jobs/{id}/cancel, ...
    dashboard.port();
}
```

### Serializers

```java
byte[] key = ...; // 16/24/32 bytes for AES
Queue secure = Taskito.builder()
        .backend("sqlite").url("taskito.db")
        .serializer(new EncryptedSerializer(new JsonSerializer(), key))
        .open();
```

## Structure

Packages are organized by feature; the root holds only the front door.

```text
org.byteveda.taskito
├── Taskito            entry point — Taskito.builder()...open()
├── Queue              public interface
├── DefaultQueue       package-private impl (not exported)
├── TaskitoException   unchecked error type
├── task/              Task, TaskFunction, EnqueueOptions
├── model/             Job, JobStatus, QueueStats, DeadJob, JobError,
│                      TaskMetric, WorkerInfo, TaskLog, JobFilter  (read-only views)
├── worker/            Worker runtime
├── locks/             Lock, LockInfo
├── scheduling/        PeriodicTask
├── workflows/         Workflow DAG builder, run, status, tracker
├── serialization/     Serializer SPI + JsonSerializer (Jackson) default
├── middleware/        Middleware hooks
├── events/            worker outcome events
├── dashboard/ webhooks/ cli/
├── spi/               QueueBackend — seam between API and the native layer
└── internal/          JNI bindings (NativeQueue, NativeWorkflows, NativeLoader, ...)
```

The `spi.QueueBackend` seam keeps the public API independent of JNI: it can be
backed by the native library (default) or an in-memory fake in tests, and leaves
room for a future FFM/Panama backend without touching the API.

## Build & checks

```bash
./gradlew build            # cargoBuild → stage native → compile → test → jar
./gradlew test             # JUnit 5
./gradlew spotlessApply    # format (palantir-java-format)
./gradlew spotlessCheck    # verify formatting
./gradlew checkstyleMain   # static analysis
./gradlew check            # test + spotlessCheck + checkstyle
```

The Rust shell is built and checked with the workspace tooling:

```bash
cargo build -p taskito-java --release --features postgres,redis
cargo fmt -p taskito-java -- --check
cargo clippy -p taskito-java -- -D warnings
```

### Native library resolution

At runtime the platform binary is extracted from the JAR and loaded. For local
development against a freshly built library, point the loader at it directly:

```bash
-Dtaskito.native.lib=/abs/path/to/target/release/libtaskito_java.so
```
