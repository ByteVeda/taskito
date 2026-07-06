/**
 * A signed, serializable reference to a non-serializable resource. Produced by
 * {@link Proxies.deconstruct} on the producer, carried in a task payload, and
 * resolved back on the worker. Wire peers emit explicit JSON nulls for the
 * optional fields, so both `null` and `undefined` must be accepted.
 */
export interface ProxyRef {
  /** Id of the handler that produced (and can resolve) this ref. */
  handler: string;
  /** Serializable reference data (e.g. a file path). */
  reference: Record<string, unknown>;
  /** Base64 HMAC-SHA256 over the ref's canonical form — the cross-SDK contract. */
  signature: string;
  /** Unix-ms expiry, or null/absent for no expiry. */
  expiresAtMs?: number | null;
  /** Optional purpose the ref is bound to; workers may require a match. */
  purpose?: string | null;
}

/**
 * Deconstructs a non-serializable resource of type `T` into a serializable
 * reference, and reconstructs it on the worker. Register handlers with a
 * {@link Proxies} registry.
 *
 * Reference values must stay within the canonical signing form — strings,
 * booleans, safe integers, nulls, and nested objects/arrays of those.
 * Non-integer numbers are rejected at signing time (their textual form is not
 * stable across the cross-SDK contract); encode decimals as strings.
 */
export interface ProxyHandler<T = unknown> {
  /** Stable id stored in the {@link ProxyRef} and used to find this handler on the worker. */
  readonly id: string;
  /** Whether this handler can proxy `value`. */
  handles(value: unknown): boolean;
  /** Reduce `value` to a serializable reference (e.g. a file path, a config map). */
  deconstruct(value: T): Record<string, unknown>;
  /** Rebuild the resource from a reference produced by {@link ProxyHandler.deconstruct}. */
  reconstruct(reference: Record<string, unknown>): T;
  /**
   * Release a value this handler reconstructed. Called once per reconstructed
   * value when a `ProxySession` closes; absence means no-op. Direct
   * {@link Proxies.reconstruct} calls have no lifecycle and never trigger it.
   */
  cleanup?(value: T): void;
}
