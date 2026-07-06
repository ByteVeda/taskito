import { createHmac, timingSafeEqual } from "node:crypto";
import { CryptoError } from "../errors";
import type { PayloadCodec } from "./codec";

/** HMAC-SHA256 digest length in bytes. */
const MAC_BYTES = 32;

/**
 * HMAC-SHA256 signing codec (authenticates, does not encrypt). Wire format:
 * `[32-byte mac][body]` — the cross-SDK contract. The key is raw bytes shared
 * by producers and workers.
 */
export class HmacCodec implements PayloadCodec {
  private readonly key: Buffer;

  constructor(key: Uint8Array) {
    if (key.length === 0) {
      throw new CryptoError("HmacCodec: key must not be empty");
    }
    this.key = Buffer.from(key);
  }

  encode(data: Uint8Array): Uint8Array {
    return Buffer.concat([this.macFor(data), data]);
  }

  decode(data: Uint8Array): Uint8Array {
    if (data.length < MAC_BYTES) {
      throw new CryptoError("HmacCodec: signed payload is too short");
    }
    const buf = Buffer.from(data);
    const mac = buf.subarray(0, MAC_BYTES);
    const body = buf.subarray(MAC_BYTES);
    if (!timingSafeEqual(mac, this.macFor(body))) {
      throw new CryptoError("HmacCodec: signature mismatch (tampered or wrong key)");
    }
    return body;
  }

  private macFor(body: Uint8Array): Buffer {
    return createHmac("sha256", this.key).update(body).digest();
  }
}
