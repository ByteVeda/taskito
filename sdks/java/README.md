# Taskito Java SDK

A typed Java 11+ client over the Taskito Rust core, via a hand-written JNI shell
(`crates/taskito-java`).

> Status: **build-out** (Phases 0–2). Producer + inspection + admin + logs, and
> worker task execution, are implemented and verified end-to-end against the
> native library. Dashboard, webhooks, and the CLI follow in later phases.

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
