/**
 * Pluggable codec for task arguments and results. Mirrors the Python shell's
 * `Serializer` protocol so a future msgpack implementation can interoperate
 * across languages. The Rust core stores payloads as opaque bytes.
 */
export interface Serializer {
  serialize(value: unknown): Uint8Array;
  deserialize(bytes: Uint8Array): unknown;
}

/** Default serializer: JSON. Language-neutral and human-debuggable. */
export class JsonSerializer implements Serializer {
  serialize(value: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(value ?? null));
  }

  deserialize(bytes: Uint8Array): unknown {
    return JSON.parse(new TextDecoder().decode(bytes));
  }
}
