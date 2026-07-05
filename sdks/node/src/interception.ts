/**
 * Producer-side enqueue interception. Interceptors registered via
 * `Queue.intercept` run at the very start of every enqueue — before per-task
 * defaults, middleware, gates, and serialization — and decide what happens
 * to the call:
 *
 * - `pass` — enqueue unchanged.
 * - `convert` — replace the args (task name unchanged), e.g. redact a field.
 * - `redirect` — enqueue a different task with new args instead.
 * - `reject` — block the enqueue; `Queue.enqueue` throws `InterceptionError`.
 *
 * Interceptors chain in registration order, each seeing the previous one's
 * output. Distinct from `Middleware.onEnqueue` (mutate-in-place hooks) and
 * from the Python SDK's argument-type interception.
 */
export type Interception =
  | { readonly type: "pass" }
  | { readonly type: "convert"; readonly args: unknown[] }
  | { readonly type: "redirect"; readonly taskName: string; readonly args: unknown[] }
  | { readonly type: "reject"; readonly reason: string };

/** Decides the outcome of an enqueue. Runs synchronously before serialization. */
export type Interceptor = (taskName: string, args: unknown[]) => Interception;

/** Factories for the four {@link Interception} outcomes. */
export const Interception = {
  /** Enqueue the original args unchanged. */
  pass(): Interception {
    return { type: "pass" };
  },
  /** Replace the args; the task name stays the same. */
  convert(args: unknown[]): Interception {
    return { type: "convert", args };
  },
  /** Enqueue a different task with new args instead of the original. */
  redirect(taskName: string, args: unknown[]): Interception {
    return { type: "redirect", taskName, args };
  },
  /** Block the enqueue; the reason is surfaced on the thrown error. */
  reject(reason: string): Interception {
    return { type: "reject", reason };
  },
};
