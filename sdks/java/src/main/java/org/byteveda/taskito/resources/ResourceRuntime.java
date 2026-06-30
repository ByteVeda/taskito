package org.byteveda.taskito.resources;

import java.lang.System.Logger;
import java.lang.System.Logger.Level;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Consumer;
import org.byteveda.taskito.errors.ResourceException;

/**
 * Registry and lifecycle for worker resources. The client-level instance holds
 * the definitions and per-resource counters; each worker gets its own live
 * runtime via {@link #forWorker()}, sharing those definitions/counters but with
 * its own cache of worker-scoped instances — so a {@code WORKER}-scoped resource
 * is one instance <em>per worker</em>, not one per client. Worker-scoped
 * resources are built at most once per worker (under a per-name lock, so a
 * concurrent first-use does not double-build) and disposed LIFO when that
 * worker's last lease is released.
 */
public final class ResourceRuntime {
    private static final Logger LOG = System.getLogger(ResourceRuntime.class.getName());
    /** Cache sentinel for a factory that legitimately returned {@code null}. */
    private static final Object NULL = new Object();

    private final ConcurrentMap<String, ResourceDefinition> definitions;
    private final ConcurrentMap<String, Counter> counters;
    private final ConcurrentMap<String, Object> workerCache = new ConcurrentHashMap<>();
    private final ConcurrentMap<String, ReentrantLock> workerLocks = new ConcurrentHashMap<>();
    private final Deque<Runnable> workerTeardown = new ArrayDeque<>();
    private int leases; // guarded by this

    /** Context handed to a worker factory: it may only use other worker resources. */
    private final ResourceContext workerContext = new ResourceContext() {
        @Override
        public ResourceScope scope() {
            return ResourceScope.WORKER;
        }

        @Override
        public <T> T use(String name) {
            return cast(resolveWorker(name));
        }
    };

    /** A client-level runtime: holds definitions + counters, hands each worker a child via {@link #forWorker()}. */
    public ResourceRuntime() {
        this.definitions = new ConcurrentHashMap<>();
        this.counters = new ConcurrentHashMap<>();
    }

    private ResourceRuntime(
            ConcurrentMap<String, ResourceDefinition> definitions, ConcurrentMap<String, Counter> counters) {
        this.definitions = definitions;
        this.counters = counters;
    }

    /**
     * A per-worker runtime sharing this runtime's definitions and counters but with
     * its own worker-scoped cache, teardown stack, and lease count — so each worker
     * builds and disposes its own {@code WORKER}-scoped instances.
     */
    public ResourceRuntime forWorker() {
        return new ResourceRuntime(definitions, counters);
    }

    /** Register a resource under {@code name}, replacing any prior definition. */
    public void register(String name, ResourceDefinition definition) {
        definitions.put(name, definition);
        counters.computeIfAbsent(name, key -> new Counter());
    }

    /** Whether any resource is registered (lets the worker skip all wiring when unused). */
    public boolean isEmpty() {
        return definitions.isEmpty();
    }

    /** A fresh per-invocation scope for one task. */
    public TaskScope createTaskScope() {
        return new TaskScope(this);
    }

    /** Lease the worker resources (paired with {@link #teardownWorker}). */
    public synchronized void acquireWorker() {
        leases++;
    }

    /** Release a worker lease; when the last one drops, dispose worker resources LIFO. */
    public synchronized void teardownWorker() {
        if (leases > 0) {
            leases--;
        }
        if (leases == 0) {
            disposeWorker();
        }
    }

    /** Per-resource counters snapshot. */
    public Map<String, ResourceStat> metrics() {
        Map<String, ResourceStat> out = new LinkedHashMap<>();
        counters.forEach((name, counter) -> {
            long created = counter.created.get();
            long disposed = counter.disposed.get();
            out.put(name, new ResourceStat(created, disposed, created - disposed));
        });
        return out;
    }

    /** Resolve a worker-scoped resource, building it once under a per-name lock. */
    Object resolveWorker(String name) {
        ResourceDefinition definition = definition(name);
        if (definition.scope() != ResourceScope.WORKER) {
            throw new ResourceException("resource '" + name + "' is task-scoped; a worker resource cannot use it");
        }
        Object cached = workerCache.get(name);
        if (cached != null) {
            return unwrap(cached);
        }
        ReentrantLock lock = workerLocks.computeIfAbsent(name, key -> new ReentrantLock());
        lock.lock();
        try {
            cached = workerCache.get(name);
            if (cached != null) {
                return unwrap(cached);
            }
            Object value = build(name, definition, workerContext);
            workerCache.put(name, value == null ? NULL : value);
            counter(name).created.incrementAndGet();
            if (definition.dispose() != null) {
                synchronized (workerTeardown) {
                    workerTeardown.push(() -> dispose(name, value, definition.dispose()));
                }
            }
            return value;
        } finally {
            lock.unlock();
        }
    }

    /** Resolve for a task: worker-scoped hits the shared cache; task-scoped builds once per invocation. */
    Object resolveForTask(TaskScope scope, String name) {
        ResourceDefinition definition = definition(name);
        if (definition.scope() == ResourceScope.WORKER) {
            return resolveWorker(name);
        }
        Map<String, Object> cache = scope.cache();
        Object cached = cache.get(name);
        if (cached != null) {
            return unwrap(cached);
        }
        Object value = build(name, definition, scope);
        cache.put(name, value == null ? NULL : value);
        counter(name).created.incrementAndGet();
        if (definition.dispose() != null) {
            scope.pushTeardown(() -> dispose(name, value, definition.dispose()));
        }
        return value;
    }

    private Object build(String name, ResourceDefinition definition, ResourceContext context) {
        try {
            return definition.factory().apply(context);
        } catch (RuntimeException e) {
            throw new ResourceException("failed to build resource '" + name + "'", e);
        }
    }

    private void disposeWorker() {
        synchronized (workerTeardown) {
            while (!workerTeardown.isEmpty()) {
                workerTeardown.pop().run();
            }
        }
        workerCache.clear();
    }

    private void dispose(String name, Object value, Consumer<Object> disposer) {
        try {
            disposer.accept(unwrap(value));
            counter(name).disposed.incrementAndGet();
        } catch (RuntimeException e) {
            // A disposer must never fail teardown — record and continue.
            LOG.log(Level.WARNING, "disposing resource '" + name + "' failed", e);
        }
    }

    private ResourceDefinition definition(String name) {
        ResourceDefinition definition = definitions.get(name);
        if (definition == null) {
            throw new ResourceException("unknown resource '" + name + "'");
        }
        return definition;
    }

    private Counter counter(String name) {
        return counters.computeIfAbsent(name, key -> new Counter());
    }

    private static Object unwrap(Object value) {
        return value == NULL ? null : value;
    }

    @SuppressWarnings("unchecked")
    private static <T> T cast(Object value) {
        return (T) value;
    }

    /** Mutable per-resource counters. */
    private static final class Counter {
        final AtomicLong created = new AtomicLong();
        final AtomicLong disposed = new AtomicLong();
    }
}
