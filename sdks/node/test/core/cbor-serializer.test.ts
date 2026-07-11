import { describe, expect, it } from "vitest";
import { SerializationError } from "../../src/errors";
import { CborSerializer } from "../../src/index";
import { deserializeCall, JsonSerializer, serializeCall } from "../../src/serializers";

describe("CborSerializer", () => {
  it("round-trips structured values", () => {
    const s = new CborSerializer();
    const value = { a: 1, b: [2, 3], c: "x", d: true, e: null };
    expect(s.deserialize(s.serialize(value))).toEqual(value);
  });

  it("writes the 0x02 wire tag", () => {
    const s = new CborSerializer();
    expect(s.serialize([1, 2])[0]).toBe(0x02);
    expect(s.serializeCall([1, 2])[0]).toBe(0x02);
  });

  it("round-trips BigInt beyond Number.MAX_SAFE_INTEGER", () => {
    const s = new CborSerializer();
    const big = 2n ** 64n + 1n;
    expect(s.deserialize(s.serialize(big))).toBe(big);
  });

  it("round-trips Date values", () => {
    const s = new CborSerializer();
    const moment = new Date("2026-07-11T12:30:45.000Z");
    expect(s.deserialize(s.serialize(moment))).toEqual(moment);
  });

  it("encodes calls as the [args, kwargs] wire shape", () => {
    const s = new CborSerializer();
    const bytes = s.serializeCall([1, "a"]);
    expect(s.deserialize(bytes)).toEqual([[1, "a"], {}]);
  });

  it("matches the BINDING_CONTRACT test vector for f(1, 'a')", () => {
    const s = new CborSerializer();
    expect(Buffer.from(s.serializeCall([1, "a"])).toString("hex")).toBe("028282016161a0");
  });

  it("deserializeCall returns positional args", () => {
    const s = new CborSerializer();
    expect(s.deserializeCall(s.serializeCall([1, "a", { k: true }]))).toEqual([
      1,
      "a",
      { k: true },
    ]);
  });

  it("surfaces non-empty kwargs as a trailing options object", () => {
    const s = new CborSerializer();
    const encoder = s.serialize([["pos"], { named: 1 }]);
    expect(s.deserializeCall(encoder)).toEqual(["pos", { named: 1 }]);
  });

  it("rejects a native-tagged (0x00) payload with a clear error", () => {
    const s = new CborSerializer();
    expect(() => s.deserialize(new Uint8Array([0x00, 0x80]))).toThrow(/native-tagged/);
  });

  it("rejects untagged payloads", () => {
    const s = new CborSerializer();
    expect(() => s.deserialize(new TextEncoder().encode('{"json":true}'))).toThrow(
      SerializationError,
    );
  });

  it("rejects an empty payload", () => {
    const s = new CborSerializer();
    expect(() => s.deserialize(new Uint8Array())).toThrow(/empty/);
  });

  it("rejects a call payload that is not [args, kwargs]", () => {
    const s = new CborSerializer();
    expect(() => s.deserializeCall(s.serialize({ not: "a call" }))).toThrow(/wire shape/);
  });

  it("encodes Map values as plain RFC 8949 maps, not tag 259", () => {
    const s = new CborSerializer();
    const bytes = s.serialize(new Map([["k", 1]]));
    // tag byte + a1 (1-entry map) + 61 6b ("k") + 01 — no d9 0103 (tag 259) prefix
    expect(Buffer.from(bytes).toString("hex")).toBe("02a1616b01");
  });
});

describe("call-shape helpers", () => {
  it("fall back to plain serialize for non-call-aware serializers", () => {
    const s = new JsonSerializer();
    const bytes = serializeCall(s, [1, 2]);
    expect(s.deserialize(bytes)).toEqual([1, 2]);
    expect(deserializeCall(s, bytes)).toEqual([1, 2]);
  });

  it("route through the wire shape for call-aware serializers", () => {
    const s = new CborSerializer();
    expect(deserializeCall(s, serializeCall(s, [7]))).toEqual([7]);
  });
});
