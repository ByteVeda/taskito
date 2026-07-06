import { ProxyError } from "../errors";
import { createLogger } from "../utils/logger";
import type { Proxies } from "./proxies";
import type { ProxyRef } from "./types";

const log = createLogger("proxies");

/**
 * A unit-of-work wrapper over {@link Proxies} adding identity dedup and a
 * cleanup lifecycle. Within one session:
 *
 * - {@link ProxySession.deconstruct} memoizes by (instance identity, purpose)
 *   — deconstructing the same object again returns the same {@link ProxyRef}
 *   without calling the handler twice. The first call's TTL wins per
 *   (instance, purpose); use a new session to refresh expiry.
 * - {@link ProxySession.reconstruct} memoizes by the ref's signature — every
 *   ref to the same underlying resource resolves to the same instance, and
 *   the handler reconstructs it once. Signature, expiry, and purpose are
 *   re-verified on every call, memo hit or not, so a ref that expires
 *   mid-session stops resolving.
 * - {@link ProxySession.close} runs the handler's `cleanup` once per unique
 *   reconstructed instance, in reverse reconstruction order (LIFO).
 *
 * Not thread-safe conceptually — a session models one producer batch or one
 * task invocation; don't share it across concurrent work.
 */
export class ProxySession {
  private readonly proxies: Proxies;
  private readonly deconstructed = new Map<unknown, Map<string | undefined, ProxyRef>>();
  private readonly reconstructed = new Map<string, unknown>();
  private readonly cleanups: Array<() => void> = [];
  private closed = false;

  /** Construct via {@link Proxies.session}, not directly. */
  constructor(proxies: Proxies) {
    this.proxies = proxies;
  }

  /**
   * Deconstruct `value` (optionally bound to a TTL and a purpose), deduped by
   * (instance identity, purpose). The underlying registry deconstructs each
   * (instance, purpose) pair once; a later call with a different `ttlMs` is
   * silently ignored — open a new session to refresh expiry.
   */
  deconstruct(value: unknown, opts?: { ttlMs?: number; purpose?: string }): ProxyRef {
    this.ensureOpen();
    const purpose = opts?.purpose;
    const cached = this.deconstructed.get(value)?.get(purpose);
    if (cached) {
      return cached;
    }
    // Delegate before memoizing so an invalid value (e.g. null) throws the
    // registry's error without leaving a memo entry behind.
    const ref = this.proxies.deconstruct(value, opts);
    let byPurpose = this.deconstructed.get(value);
    if (!byPurpose) {
      byPurpose = new Map();
      this.deconstructed.set(value, byPurpose);
    }
    byPurpose.set(purpose, ref);
    return ref;
  }

  /**
   * Verify (always — including memo hits, so a ref that expires mid-session
   * stops resolving) and reconstruct `ref`, deduped by its signature.
   */
  reconstruct(ref: ProxyRef, expectedPurpose?: string): unknown {
    this.ensureOpen();
    const handler = this.proxies.handlerFor(ref.handler);
    this.proxies.verifyRef(ref, expectedPurpose);
    if (this.reconstructed.has(ref.signature)) {
      return this.reconstructed.get(ref.signature);
    }
    const value = handler.reconstruct(ref.reference);
    this.reconstructed.set(ref.signature, value);
    this.cleanups.push(() => handler.cleanup?.(value));
    return value;
  }

  /** {@link ProxySession.reconstruct} cast to the caller's type. */
  resolve<T>(ref: ProxyRef, expectedPurpose?: string): T {
    return this.reconstruct(ref, expectedPurpose) as T;
  }

  /**
   * Run the handler's `cleanup` for every reconstructed instance in reverse
   * order (LIFO), once each. Cleanup failures are logged and never skip the
   * rest — close always completes and never throws (teardown convention).
   * Idempotent.
   */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (let cleanup = this.cleanups.pop(); cleanup !== undefined; cleanup = this.cleanups.pop()) {
      try {
        cleanup();
      } catch (error) {
        // Cleanup must never fail the rest of the teardown — log and continue.
        log.warn("proxy cleanup failed", error);
      }
    }
    this.deconstructed.clear();
    this.reconstructed.clear();
  }

  [Symbol.dispose](): void {
    this.close();
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new ProxyError("proxy session is closed");
    }
  }
}
