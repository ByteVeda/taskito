/**
 * Pluggable codec for task arguments and results. Mirrors the Python shell's
 * `Serializer` protocol so implementations can interoperate across languages.
 * The Rust core stores payloads as opaque bytes.
 */
export interface Serializer {
  serialize(value: unknown): Uint8Array;
  deserialize(bytes: Uint8Array): unknown;
}
