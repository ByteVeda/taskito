/**
 * Pluggable codec for task arguments and results. Mirrors the cross-SDK
 * serializer contract so implementations can interoperate across languages.
 * The Rust core stores payloads as opaque bytes.
 */
export interface Serializer {
  serialize(value: unknown): Uint8Array;
  deserialize(bytes: Uint8Array): unknown;
  /**
   * Optional call-shaped encoding: wire serializers write the cross-SDK call
   * body `[args, kwargs]` (BINDING_CONTRACT.md) instead of a bare args array.
   * Results always use `serialize`/`deserialize`.
   */
  serializeCall?(args: unknown[]): Uint8Array;
  /** Inverse of {@link serializeCall}: returns handler-ready positional args. */
  deserializeCall?(bytes: Uint8Array): unknown[];
}

/** Encode task args via `serializeCall` when the serializer is call-aware. */
export function serializeCall(serializer: Serializer, args: unknown[]): Uint8Array {
  return serializer.serializeCall ? serializer.serializeCall(args) : serializer.serialize(args);
}

/** Decode a call payload into positional args, honoring call-aware serializers. */
export function deserializeCall(serializer: Serializer, bytes: Uint8Array): unknown[] {
  return serializer.deserializeCall
    ? serializer.deserializeCall(bytes)
    : (serializer.deserialize(bytes) as unknown[]);
}
