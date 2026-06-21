import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { SerializationError } from "../errors";
import { JsonSerializer } from "./json";
import type { Serializer } from "./serializer";

const ALGORITHM = "aes-256-gcm";
/** GCM nonce length in bytes. */
const IV_BYTES = 12;
/** GCM authentication-tag length in bytes. */
const TAG_BYTES = 16;

/**
 * Wraps another serializer with AES-256-GCM authenticated encryption. Each
 * payload is laid out as `[iv | authTag | ciphertext]`; {@link deserialize}
 * decrypts and verifies the GCM tag, rejecting tampered or wrong-key payloads.
 * The 32-byte key is derived from `secret` via SHA-256, so producers and workers
 * need only share the secret string.
 *
 * Provides confidentiality **and** integrity — a superset of
 * {@link SignedSerializer}, which authenticates without hiding the body.
 */
export class EncryptedSerializer implements Serializer {
  private readonly key: Buffer;
  private readonly inner: Serializer;

  constructor(secret: string, inner: Serializer = new JsonSerializer()) {
    if (!secret) {
      throw new SerializationError("EncryptedSerializer requires a non-empty secret");
    }
    this.key = createHash("sha256").update(secret).digest();
    this.inner = inner;
  }

  serialize(value: unknown): Uint8Array {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const body = Buffer.from(this.inner.serialize(value));
    const ciphertext = Buffer.concat([cipher.update(body), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  deserialize(bytes: Uint8Array): unknown {
    const buf = Buffer.from(bytes);
    if (buf.length < IV_BYTES + TAG_BYTES) {
      throw new SerializationError("EncryptedSerializer: payload too short to be encrypted");
    }
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    let body: Buffer;
    try {
      body = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      throw new SerializationError(
        "EncryptedSerializer: decryption failed (tampered payload or wrong secret)",
      );
    }
    return this.inner.deserialize(body);
  }
}
