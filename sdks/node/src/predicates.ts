/** What a predicate sees when a job is being enqueued. */
export interface PredicateContext {
  readonly taskName: string;
  /** The positional args (after any `onEnqueue` rewrites). */
  readonly args: readonly unknown[];
}

/**
 * A gate evaluated at enqueue time. Returning `false` rejects the submission
 * with a {@link PredicateRejectedError}. Register one with {@link Queue.gate}.
 */
export type Predicate = (ctx: PredicateContext) => boolean;

/** A predicate that passes only when every `predicates` member passes. */
export function allOf(...predicates: Predicate[]): Predicate {
  return (ctx) => predicates.every((predicate) => predicate(ctx));
}

/** A predicate that passes when any `predicates` member passes. */
export function anyOf(...predicates: Predicate[]): Predicate {
  return (ctx) => predicates.some((predicate) => predicate(ctx));
}

/** A predicate that passes when `predicate` fails. */
export function not(predicate: Predicate): Predicate {
  return (ctx) => !predicate(ctx);
}
