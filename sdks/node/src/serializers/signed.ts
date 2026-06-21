import { createHmac, timingSafeEqual } from "node:crypto";
import { TaskitoError } from "../errors";
import { JsonSerializer } from "./json";
import type { Serializer } from "./serializer";

/** HMAC-SHA256 digest length in bytes — the fixed-size tag prefixed to each payload. */
const TAG_BYTES = 32;

/**
 * Wraps another serializer, prefixing every payload with an HMAC-SHA256 tag
 * keyed by a shared secret. {@link deserialize} recomputes and verifies the tag
 * (timing-safe) before delegating, so a tampered, truncated, or wrong-secret
 * payload is rejected instead of decoded.
 *
 * Producers and workers must share the same secret. This authenticates payload
 * integrity and origin — it does **not** encrypt; the body is still readable by
 * anyone with storage access.
 */
export class SignedSerializer implements Serializer {
  private readonly secret: string;
  private readonly inner: Serializer;

  constructor(secret: string, inner: Serializer = new JsonSerializer()) {
    if (!secret) {
      throw new TaskitoError("SignedSerializer requires a non-empty secret");
    }
    this.secret = secret;
    this.inner = inner;
  }

  serialize(value: unknown): Uint8Array {
    const body = Buffer.from(this.inner.serialize(value));
    const tag = this.tagFor(body);
    return Buffer.concat([tag, body]);
  }

  deserialize(bytes: Uint8Array): unknown {
    const buf = Buffer.from(bytes);
    if (buf.length < TAG_BYTES) {
      throw new TaskitoError("SignedSerializer: payload too short to be signed");
    }
    const tag = buf.subarray(0, TAG_BYTES);
    const body = buf.subarray(TAG_BYTES);
    if (!timingSafeEqual(tag, this.tagFor(body))) {
      throw new TaskitoError("SignedSerializer: signature mismatch (tampered or wrong secret)");
    }
    return this.inner.deserialize(body);
  }

  private tagFor(body: Buffer): Buffer {
    return createHmac("sha256", this.secret).update(body).digest();
  }
}
