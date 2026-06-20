import { describe, expect, it } from "vitest";
import { JsonSerializer } from "../src/index";

describe("JsonSerializer", () => {
  it("round-trips structured values", () => {
    const serializer = new JsonSerializer();
    const value = { a: 1, b: [2, 3], c: "x" };
    expect(serializer.deserialize(serializer.serialize(value))).toEqual(value);
  });

  it("encodes undefined as null", () => {
    const serializer = new JsonSerializer();
    expect(serializer.deserialize(serializer.serialize(undefined))).toBeNull();
  });
});
