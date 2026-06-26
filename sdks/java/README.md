# Taskito Java SDK

A typed Java 11+ client over the Taskito Rust core, via a hand-written JNI shell
(`crates/taskito-java`).

> Status: **build-out** (Phases 0–3 core). Producer + inspection + admin + logs,
> worker task execution, middleware, signed/encrypted serializers, and the
> dashboard server are implemented and verified end-to-end. Webhooks and the CLI
> follow next.

## Usage

### Enqueue

```java
import org.byteveda.taskito.*;
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

```text
org.byteveda.taskito
├── Taskito            entry point — Taskito.builder()...open()
├── Queue              public interface
├── DefaultQueue       package-private impl (not exported)
├── Task / Job / JobStatus / QueueStats / EnqueueOptions   typed model
├── TaskitoException   unchecked error type
├── serialization/     Serializer SPI + JsonSerializer (Jackson) default
├── spi/               QueueBackend — seam between API and the native layer
└── internal/          JNI bindings (NativeQueue, NativeLoader, JniQueueBackend)
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
