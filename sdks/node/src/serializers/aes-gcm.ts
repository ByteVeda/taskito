import { type CipherGCMTypes, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { CryptoError } from "../errors";
import type { PayloadCodec } from "./codec";

/** GCM nonce length in bytes. */
const IV_BYTES = 12;
/** GCM authentication-tag length in bytes. */
const TAG_BYTES = 16;

const CIPHER_BY_KEY_LENGTH: Record<number, CipherGCMTypes> = {
  16: "aes-128-gcm",
  24: "aes-192-gcm",
  32: "aes-256-gcm",
};

/**
 * AES-GCM encryption codec. Wire format: `[12-byte random IV][ciphertext ||
 * 16-byte GCM tag]`. Note the tag trails the ciphertext, unlike
 * {@link EncryptedSerializer}'s `[iv | tag | ciphertext]` layout — do not
 * "align" them; this order is the cross-SDK contract.
 *
 * The key must be raw bytes of length 16, 24, or 32 (AES-128/192/256), shared
 * by producers and workers.
 */
export class AesGcmCodec implements PayloadCodec {
  private readonly key: Buffer;
  private readonly cipherName: CipherGCMTypes;

  constructor(key: Uint8Array) {
    const cipherName = CIPHER_BY_KEY_LENGTH[key.length];
    if (!cipherName) {
      throw new CryptoError(
        `AesGcmCodec: key must be 16, 24, or 32 bytes for AES-128/192/256, got ${key.length}`,
      );
    }
    this.key = Buffer.from(key);
    this.cipherName = cipherName;
  }

  encode(data: Uint8Array): Uint8Array {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(this.cipherName, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]);
  }

  decode(data: Uint8Array): Uint8Array {
    if (data.length < IV_BYTES + TAG_BYTES) {
      throw new CryptoError("AesGcmCodec: encrypted payload is too short");
    }
    const buf = Buffer.from(data);
    const iv = buf.subarray(0, IV_BYTES);
    const ciphertext = buf.subarray(IV_BYTES, buf.length - TAG_BYTES);
    const tag = buf.subarray(buf.length - TAG_BYTES);
    const decipher = createDecipheriv(this.cipherName, this.key, iv);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      throw new CryptoError("AesGcmCodec: decryption failed (tampered payload or wrong key)");
    }
  }
}
