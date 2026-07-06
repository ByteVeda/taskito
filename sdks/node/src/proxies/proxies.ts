import { createHmac, timingSafeEqual } from "node:crypto";
import { ProxyError } from "../errors";
import { canonicalJson } from "./canonical";
import { ProxySession } from "./proxy-session";
import type { ProxyHandler, ProxyRef } from "./types";

/**
 * Registry that deconstructs resources into signed {@link ProxyRef}s and
 * reconstructs them. Construct with an HMAC key (shared by producer and
 * worker), register a {@link ProxyHandler} per resource type, then
 * `deconstruct` on the producer and `reconstruct` (or `resolve`) on the
 * worker. Signature layout is the cross-SDK contract, so refs verify across
 * SDKs sharing the key.
 */
export class Proxies {
  private readonly handlers = new Map<string, ProxyHandler>();
  private readonly key: Buffer;

  constructor(hmacKey: Uint8Array) {
    if (hmacKey.length === 0) {
      throw new ProxyError("proxy HMAC key must not be empty");
    }
    this.key = Buffer.from(hmacKey);
  }

  /** Register a handler under its non-empty, unique id; returns `this`. */
  register<T>(handler: ProxyHandler<T>): this {
    if (!handler.id) {
      throw new ProxyError("proxy handler id must not be empty");
    }
    // Fail fast on a duplicate: silently overwriting would let a producer and
    // worker disagree on what a given ProxyRef's handler id means.
    if (this.handlers.has(handler.id)) {
      throw new ProxyError(`proxy handler "${handler.id}" is already registered`);
    }
    this.handlers.set(handler.id, handler as ProxyHandler);
    return this;
  }

  /**
   * Deconstruct `value` into a signed ref, optionally bound to a TTL and a
   * purpose; throws if no registered handler accepts it (registration order,
   * first match wins).
   */
  deconstruct(value: unknown, opts?: { ttlMs?: number; purpose?: string }): ProxyRef {
    if (value === null || value === undefined) {
      throw new ProxyError("cannot deconstruct null");
    }
    const expiresAtMs = opts?.ttlMs === undefined ? null : Date.now() + opts.ttlMs;
    const purpose = opts?.purpose ?? null;
    for (const handler of this.handlers.values()) {
      if (handler.handles(value)) {
        const reference = handler.deconstruct(value);
        const signature = this.sign(handler.id, reference, expiresAtMs, purpose);
        return { handler: handler.id, reference, signature, expiresAtMs, purpose };
      }
    }
    throw new ProxyError(`no proxy handler for value of type ${typeof value}`);
  }

  /**
   * Verify a ref's signature, expiry, and (when `expectedPurpose` is given)
   * its bound purpose, then reconstruct the resource.
   */
  reconstruct(ref: ProxyRef, expectedPurpose?: string): unknown {
    const handler = this.handlerFor(ref.handler);
    this.verifyRef(ref, expectedPurpose);
    return handler.reconstruct(ref.reference);
  }

  /** {@link Proxies.reconstruct} cast to the caller's type. */
  resolve<T>(ref: ProxyRef, expectedPurpose?: string): T {
    return this.reconstruct(ref, expectedPurpose) as T;
  }

  /**
   * Open a {@link ProxySession} over this registry — a unit-of-work wrapper
   * adding identity dedup on deconstruct, memoization on reconstruct, and a
   * LIFO cleanup lifecycle on close.
   */
  session(): ProxySession {
    return new ProxySession(this);
  }

  /** Look up the handler registered under `handlerId`. @internal */
  handlerFor(handlerId: string): ProxyHandler {
    const handler = this.handlers.get(handlerId);
    if (!handler) {
      throw new ProxyError(`unknown proxy handler "${handlerId}"`);
    }
    return handler;
  }

  /** Verify a ref's signature, expiry, and (optionally) purpose. @internal */
  verifyRef(ref: ProxyRef, expectedPurpose?: string): void {
    const expected = Buffer.from(
      this.sign(ref.handler, ref.reference, ref.expiresAtMs, ref.purpose),
      "utf8",
    );
    const actual = Buffer.from(ref.signature ?? "", "utf8");
    // timingSafeEqual throws on length mismatch — treat that as a plain mismatch.
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new ProxyError(`proxy signature mismatch for handler "${ref.handler}"`);
    }
    if (ref.expiresAtMs != null && Date.now() > ref.expiresAtMs) {
      throw new ProxyError(`proxy ref expired for handler "${ref.handler}"`);
    }
    if (expectedPurpose !== undefined && (ref.purpose ?? null) !== expectedPurpose) {
      throw new ProxyError(`proxy purpose mismatch for handler "${ref.handler}"`);
    }
  }

  private sign(
    handlerId: string,
    reference: Record<string, unknown>,
    expiresAtMs: number | null | undefined,
    purpose: string | null | undefined,
  ): string {
    // Cross-SDK contract: an absent expiry signs as the literal string "null";
    // an absent purpose signs as the empty string.
    const message = [
      handlerId,
      canonicalJson(reference),
      expiresAtMs == null ? "null" : String(expiresAtMs),
      purpose ?? "",
    ].join("\n");
    return createHmac("sha256", this.key).update(message, "utf8").digest("base64");
  }
}
