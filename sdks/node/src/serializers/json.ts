import type { Serializer } from "./serializer";

/** Default serializer: JSON. Language-neutral and human-debuggable. */
export class JsonSerializer implements Serializer {
  serialize(value: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(value ?? null));
  }

  deserialize(bytes: Uint8Array): unknown {
    return JSON.parse(new TextDecoder().decode(bytes));
  }
}
