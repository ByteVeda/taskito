/** Lifetime of a registered resource. */
export type ResourceScope = "worker" | "task";

/**
 * Passed to a resource factory so it can depend on other resources. A
 * worker-scoped factory may only depend on other worker-scoped resources; a
 * task-scoped factory may depend on either.
 */
export interface ResourceContext {
  /** Scope of the resource currently being built. */
  readonly scope: ResourceScope;
  /** Resolve a dependency resource by name. */
  use<T>(name: string): Promise<T>;
}

/** How to build — and optionally tear down — a resource of type `T`. */
export interface ResourceDefinition<T = unknown> {
  /** Builds the value. May be async and may depend on other resources via `ctx.use`. */
  factory: (ctx: ResourceContext) => T | Promise<T>;
  /** When the value is created and disposed. */
  scope: ResourceScope;
  /** Tear-down hook, run LIFO when the scope ends (worker stop / job finish). */
  dispose?: (value: T) => void | Promise<void>;
}

/** Resolves a resource by name within the current scope. @internal */
export type ResourceResolver = (name: string) => Promise<unknown>;
