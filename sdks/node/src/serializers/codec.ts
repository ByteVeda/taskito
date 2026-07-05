import { JsonSerializer } from "./json";
import type { Serializer } from "./serializer";

/**
 * Reversible byte transform layered over a serializer — compression,
 * encryption, signing. `encode` runs on the producer after serialization;
 * `decode` reverses it on the worker before deserialization.
 *
 * Codecs compose: a chain encodes in list order and decodes in reverse, so
 * `[gzip, hmac]` verifies integrity *before* decompressing. Wire formats match
 * the Java and Python SDK codecs byte-for-byte, so codec-framed payloads are
 * cross-SDK compatible.
 */
export interface PayloadCodec {
  /** Transform serialized bytes on the producer (compress, encrypt, sign). */
  encode(data: Uint8Array): Uint8Array;
  /** Reverse the transform on the worker. */
  decode(data: Uint8Array): Uint8Array;
}

/**
 * Serializer decorator applying a codec chain around a delegate. `serialize`
 * runs the delegate then encodes codecs in list order; `deserialize` decodes
 * in reverse order then delegates. Used internally when `QueueOptions.codec`
 * is set — the chain then covers every payload and result flowing through the
 * queue serializer.
 */
export class CodecSerializer implements Serializer {
  private readonly delegate: Serializer;
  private readonly codecs: readonly PayloadCodec[];

  constructor(delegate: Serializer = new JsonSerializer(), codecs: readonly PayloadCodec[] = []) {
    this.delegate = delegate;
    this.codecs = [...codecs];
  }

  serialize(value: unknown): Uint8Array {
    let data = this.delegate.serialize(value);
    for (const codec of this.codecs) {
      data = codec.encode(data);
    }
    return data;
  }

  deserialize(bytes: Uint8Array): unknown {
    let data = bytes;
    for (const codec of [...this.codecs].reverse()) {
      data = codec.decode(data);
    }
    return this.delegate.deserialize(data);
  }
}
