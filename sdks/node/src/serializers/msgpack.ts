import { decode, encode } from "@msgpack/msgpack";
import type { Serializer } from "./serializer";

/**
 * MessagePack serializer — more compact than JSON and binary-safe. A drop-in
 * alternative to {@link JsonSerializer} for Node↔Node workloads.
 */
export class MsgpackSerializer implements Serializer {
  serialize(value: unknown): Uint8Array {
    return encode(value ?? null);
  }

  deserialize(bytes: Uint8Array): unknown {
    return decode(bytes);
  }
}
