import { TaskitoError } from "../errors";
import type { ResourceContext, ResourceDefinition, ResourceResolver } from "./types";

/** A disposal thunk plus the resource name, for error context. */
interface Teardown {
  name: string;
  run: () => void | Promise<void>;
}

/** Per-invocation task scope: caches task-scoped resources and disposes them. */
export interface TaskScope {
  /** Resolve a resource for this invocation (task cache first, then worker). */
  readonly resolver: ResourceResolver;
  /** Dispose the task-scoped resources built during this invocation, LIFO. */
  teardown(): Promise<void>;
}

/**
 * Registry + lifecycle for injectable resources. Worker-scoped values are built
 * once and shared; task-scoped values are built per invocation. The worker wires
 * this into task execution; tasks reach values via `useResource` or declarative
 * `inject`.
 *
 * Every resolver always returns a promise — guard and factory failures surface as
 * rejections, never synchronous throws — so a failed build is awaited and retried,
 * not cached.
 */
export class ResourceRuntime {
  private readonly defs = new Map<string, ResourceDefinition>();
  private readonly workerCache = new Map<string, Promise<unknown>>();
  private readonly workerTeardown: Teardown[] = [];

  /** Register (or replace) a resource definition. */
  register<T>(name: string, definition: ResourceDefinition<T>): void {
    this.defs.set(name, definition as ResourceDefinition);
  }

  /** True when nothing is registered — lets the worker skip resource wiring. */
  get isEmpty(): boolean {
    return this.defs.size === 0;
  }

  /** Build a worker-scoped resource once, memoizing the promise (dedups concurrent init). */
  private resolveWorker(name: string): Promise<unknown> {
    const cached = this.workerCache.get(name);
    if (cached) {
      return cached;
    }
    const def = this.defs.get(name);
    if (!def) {
      return Promise.reject(unregistered(name));
    }
    if (def.scope !== "worker") {
      return Promise.reject(
        new TaskitoError(
          `Resource "${name}" is task-scoped and cannot be resolved at worker scope`,
        ),
      );
    }
    const ctx: ResourceContext = {
      scope: "worker",
      use: <T>(dep: string) => this.resolveWorker(dep) as Promise<T>,
    };
    const built = startFactory(def, ctx).catch((error) => {
      this.workerCache.delete(name); // failed build is retryable, not cached
      throw error;
    });
    this.workerCache.set(name, built);
    this.registerDispose(this.workerTeardown, name, def, built);
    return built;
  }

  /** Begin a per-invocation task scope. */
  createTaskScope(): TaskScope {
    const taskCache = new Map<string, Promise<unknown>>();
    const taskTeardown: Teardown[] = [];

    const resolve: ResourceResolver = (name) => {
      const def = this.defs.get(name);
      if (!def) {
        return Promise.reject(unregistered(name));
      }
      if (def.scope === "worker") {
        return this.resolveWorker(name); // shared singleton, even when first reached here
      }
      const cached = taskCache.get(name);
      if (cached) {
        return cached;
      }
      const ctx: ResourceContext = {
        scope: "task",
        use: <T>(dep: string) => resolve(dep) as Promise<T>,
      };
      const built = startFactory(def, ctx).catch((error) => {
        taskCache.delete(name); // failed build is retryable, not cached
        throw error;
      });
      taskCache.set(name, built);
      this.registerDispose(taskTeardown, name, def, built);
      return built;
    };

    return { resolver: resolve, teardown: () => runTeardown(taskTeardown) };
  }

  /** Dispose every worker-scoped resource (LIFO) and reset the caches. */
  async teardownWorker(): Promise<void> {
    const pending = this.workerTeardown.splice(0);
    this.workerCache.clear();
    await runTeardown(pending);
  }

  /** Queue a dispose thunk that awaits the built value, if the def has one. */
  private registerDispose(
    stack: Teardown[],
    name: string,
    def: ResourceDefinition,
    built: Promise<unknown>,
  ): void {
    const { dispose } = def;
    if (dispose) {
      stack.push({ name, run: async () => dispose(await built) });
    }
  }
}

/** Run a factory, converting a synchronous throw into a rejected promise. */
function startFactory(def: ResourceDefinition, ctx: ResourceContext): Promise<unknown> {
  return new Promise((resolve) => resolve(def.factory(ctx)));
}

function unregistered(name: string): TaskitoError {
  return new TaskitoError(`No resource registered with name "${name}"`);
}

/** Run disposal thunks in reverse (LIFO) order; surface the first error after all run. */
async function runTeardown(stack: Teardown[]): Promise<void> {
  let firstError: unknown;
  for (let i = stack.length - 1; i >= 0; i--) {
    try {
      await stack[i]?.run();
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError !== undefined) {
    throw firstError;
  }
}
