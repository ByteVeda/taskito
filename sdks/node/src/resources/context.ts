import { AsyncLocalStorage } from "node:async_hooks";
import { ResourceError } from "../errors";
import type { ResourceResolver } from "./types";

const store = new AsyncLocalStorage<ResourceResolver>();

/**
 * Resolve a registered resource from inside a running task. Worker-scoped
 * resources are shared singletons; task-scoped ones are built per invocation and
 * cached for the rest of it. Throws if called outside a task.
 */
export function useResource<T>(name: string): Promise<T> {
  const resolver = store.getStore();
  if (!resolver) {
    throw new ResourceError(
      `useResource("${name}") called outside a task — only available while a handler runs`,
    );
  }
  return resolver(name) as Promise<T>;
}

/** Bind `resolver` as the ambient resource resolver while `fn` runs. @internal */
export function runWithResolver<T>(resolver: ResourceResolver, fn: () => T): T {
  return store.run(resolver, fn);
}
