package org.byteveda.taskito.resources;

import java.lang.System.Logger;
import java.lang.System.Logger.Level;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
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
    /**
     * Per-name, per-thread instances for {@code THREAD}-scoped resources. Only the
     * owning thread reads or writes its own entry (so no per-name lock is needed);
     * the concurrent maps exist for cross-thread visibility at worker teardown.
     */
    private final ConcurrentMap<String, ConcurrentMap<Thread, Object>> threadCache = new ConcurrentHashMap<>();
    /**
     * Per-name pools for {@code POOLED}-scoped resources. An instance field like
     * {@code workerCache}, so each worker runtime from {@link #forWorker()} owns
     * its own pools — capacity is per worker, never shared across workers.
     */
    private final ConcurrentMap<String, ResourcePool> pools = new ConcurrentHashMap<>();

    private final Deque<Runnable> workerTeardown = new ArrayDeque<>();
    /** Names being resolved on the current thread, so a dependency cycle fails fast instead of recursing. */
    private final ThreadLocal<Set<String>> resolving = ThreadLocal.withInitial(LinkedHashSet::new);

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

    /** Context handed to a thread factory: it may use worker or thread resources. */
    private final ResourceContext threadContext = new ResourceContext() {
        @Override
        public ResourceScope scope() {
            return ResourceScope.THREAD;
        }

        @Override
        public <T> T use(String name) {
            return cast(resolveThread(name));
        }
    };

    /**
     * Context handed to a pooled factory: it may only use worker resources —
     * pooled instances outlive tasks, so a task/request/thread-scoped dependency
     * would dangle after its own scope ends.
     */
    private final ResourceContext pooledContext = new ResourceContext() {
        @Override
        public ResourceScope scope() {
            return ResourceScope.POOLED;
        }

        @Override
        public <T> T use(String name) {
            return cast(resolvePooledDependency(name));
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

    /** Register a resource under {@code name}. A name may be registered only once. */
    public void register(String name, ResourceDefinition definition) {
        if (definitions.putIfAbsent(name, definition) != null) {
            throw new ResourceException("resource '" + name + "' is already registered");
        }
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

    /** Lease the worker resources (paired with {@link #teardownWorker}); the first lease prewarms pools. */
    public void acquireWorker() {
        boolean firstLease;
        synchronized (this) {
            firstLease = leases == 0;
            leases++;
        }
        // Outside the monitor: prewarm runs user factories, which may be slow —
        // holding the lock would stall every concurrent lease/teardown. A racing
        // shutdown is safe: the pool disposes prewarmed instances once closed.
        if (firstLease) {
            prewarmPools();
        }
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
            throw new ResourceException("resource '" + name + "' is "
                    + scopeWord(definition.scope())
                    + "-scoped; a worker resource may only use worker resources");
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

    /**
     * Resolve for a task, dispatching by the resource's scope: worker hits the
     * shared cache, thread hits the current thread's cache, request builds fresh
     * on every use, pooled checks an instance out for the invocation, task builds
     * once per invocation.
     */
    Object resolveForTask(TaskScope scope, String name) {
        ResourceDefinition definition = definition(name);
        switch (definition.scope()) {
            case WORKER:
                return resolveWorker(name);
            case THREAD:
                return resolveThread(name);
            case REQUEST:
                return buildRequest(scope, name, definition);
            case POOLED:
                return resolvePooled(scope, name, definition);
            case TASK:
            default:
                break;
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

    /**
     * Resolve a thread-scoped resource for the current worker thread, building it
     * lazily. Only the owning thread touches its own map entry, so a plain
     * get-build-put is race-free; the shared {@code workerTeardown} deque keeps
     * disposal globally LIFO across worker and thread instances.
     */
    Object resolveThread(String name) {
        ResourceDefinition definition = definition(name);
        if (definition.scope() == ResourceScope.WORKER) {
            return resolveWorker(name);
        }
        if (definition.scope() != ResourceScope.THREAD) {
            throw new ResourceException("resource '" + name + "' is "
                    + scopeWord(definition.scope())
                    + "-scoped; a thread resource may only use worker or thread resources");
        }
        ConcurrentMap<Thread, Object> perThread = threadCache.computeIfAbsent(name, key -> new ConcurrentHashMap<>());
        Object cached = perThread.get(Thread.currentThread());
        if (cached != null) {
            return unwrap(cached);
        }
        Object value = build(name, definition, threadContext);
        perThread.put(Thread.currentThread(), value == null ? NULL : value);
        counter(name).created.incrementAndGet();
        if (definition.dispose() != null) {
            synchronized (workerTeardown) {
                workerTeardown.push(() -> dispose(name, value, definition.dispose()));
            }
        }
        return value;
    }

    /** Build a request-scoped resource: fresh on every use, disposed with the task (LIFO). */
    private Object buildRequest(TaskScope scope, String name, ResourceDefinition definition) {
        Object value = build(name, definition, requestContext(scope));
        counter(name).created.incrementAndGet();
        if (definition.dispose() != null) {
            scope.pushTeardown(() -> dispose(name, value, definition.dispose()));
        }
        return value;
    }

    /**
     * Resolve a pooled resource: one checkout per task per resource, cached in the
     * task scope like a task-scoped instance and returned to the pool (not
     * disposed) when the task ends.
     */
    private Object resolvePooled(TaskScope scope, String name, ResourceDefinition definition) {
        Map<String, Object> cache = scope.cache();
        Object cached = cache.get(name);
        if (cached != null) {
            return unwrap(cached);
        }
        ResourcePool pool = pool(name, definition);
        Object value = pool.acquire();
        cache.put(name, value == null ? NULL : value);
        scope.pushTeardown(() -> pool.release(value));
        return value;
    }

    /** Resolve a pooled factory's dependency, enforcing the worker-only guard. */
    private Object resolvePooledDependency(String name) {
        ResourceDefinition definition = definition(name);
        if (definition.scope() != ResourceScope.WORKER) {
            throw new ResourceException("resource '" + name + "' is "
                    + scopeWord(definition.scope())
                    + "-scoped; a pooled resource may only use worker resources");
        }
        return resolveWorker(name);
    }

    /** The pool for {@code name}, created lazily on first use. */
    private ResourcePool pool(String name, ResourceDefinition definition) {
        return pools.computeIfAbsent(name, key -> createPool(name, definition));
    }

    /**
     * A pool whose factory and disposer keep the per-resource counters honest:
     * {@code created} moves only when the factory builds, {@code disposed} only
     * when the pool actually disposes — checkout/return never touch them.
     */
    private ResourcePool createPool(String name, ResourceDefinition definition) {
        return new ResourcePool(
                name,
                definition.pool(),
                () -> {
                    Object value = build(name, definition, pooledContext);
                    counter(name).created.incrementAndGet();
                    return value;
                },
                value -> disposePooled(name, value, definition.dispose()));
    }

    /** Dispose one pooled instance; without a disposer the drop still counts as disposed. */
    private void disposePooled(String name, Object value, Consumer<Object> disposer) {
        if (disposer == null) {
            counter(name).disposed.incrementAndGet();
            return;
        }
        dispose(name, value, disposer);
    }

    /** Eagerly build {@code poolMin} instances for every pooled resource that asks for prewarm. */
    private void prewarmPools() {
        definitions.forEach((name, definition) -> {
            if (definition.scope() == ResourceScope.POOLED && definition.pool().poolMin() > 0) {
                pool(name, definition).prewarm();
            }
        });
    }

    /** Context handed to a request factory: dependencies resolve through the active task scope. */
    private ResourceContext requestContext(TaskScope scope) {
        return new ResourceContext() {
            @Override
            public ResourceScope scope() {
                return ResourceScope.REQUEST;
            }

            @Override
            public <T> T use(String name) {
                return scope.use(name);
            }
        };
    }

    private Object build(String name, ResourceDefinition definition, ResourceContext context) {
        Set<String> chain = resolving.get();
        if (!chain.add(name)) {
            throw new ResourceException("circular resource dependency at '" + name + "' (chain: " + chain + ")");
        }
        try {
            return definition.factory().apply(context);
        } catch (ResourceException e) {
            throw e; // a nested unknown/cycle/build failure already carries its message
        } catch (RuntimeException e) {
            throw new ResourceException("failed to build resource '" + name + "'", e);
        } finally {
            chain.remove(name);
        }
    }

    private void disposeWorker() {
        // Pools first: pooled instances may depend on worker resources, which the
        // teardown stack below disposes.
        pools.values().forEach(ResourcePool::shutdown);
        pools.clear();
        synchronized (workerTeardown) {
            while (!workerTeardown.isEmpty()) {
                workerTeardown.pop().run();
            }
        }
        workerCache.clear();
        threadCache.clear();
    }

    private static String scopeWord(ResourceScope scope) {
        return scope.name().toLowerCase(Locale.ROOT);
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
