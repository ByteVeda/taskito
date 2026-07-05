import { gunzipSync, gzipSync } from "node:zlib";
import { SerializationError } from "../errors";
import type { PayloadCodec } from "./codec";

/** Default decompression cap: 64 MiB. */
const DEFAULT_MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;

/**
 * Gzip compression codec. Decompression is capped at `maxDecompressedBytes`
 * (default 64 MiB) so a malicious or corrupt payload cannot expand into a zip
 * bomb. Wire format matches the Java and Python SDK gzip codecs.
 */
export class GzipCodec implements PayloadCodec {
  private readonly maxDecompressedBytes: number;

  constructor(maxDecompressedBytes: number = DEFAULT_MAX_DECOMPRESSED_BYTES) {
    if (!Number.isInteger(maxDecompressedBytes) || maxDecompressedBytes <= 0) {
      throw new SerializationError(
        `GzipCodec: maxDecompressedBytes must be a positive integer, got ${maxDecompressedBytes}`,
      );
    }
    this.maxDecompressedBytes = maxDecompressedBytes;
  }

  encode(data: Uint8Array): Uint8Array {
    return gzipSync(data);
  }

  decode(data: Uint8Array): Uint8Array {
    try {
      return gunzipSync(data, { maxOutputLength: this.maxDecompressedBytes });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE") {
        throw new SerializationError(
          `GzipCodec: decompressed payload exceeds the ${this.maxDecompressedBytes}-byte limit`,
        );
      }
      throw new SerializationError(`GzipCodec: decompression failed (${String(error)})`);
    }
  }
}
