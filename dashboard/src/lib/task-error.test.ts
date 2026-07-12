import { describe, expect, it } from "vitest";
import { parseTaskError, taskErrorSummary, taskErrorTooltip } from "./task-error";

describe("parseTaskError", () => {
  it("parses the canonical contract shape", () => {
    expect(
      parseTaskError(
        '{"errtype":"BoomError","message":"it broke","traceback":["frame1","frame2"]}',
      ),
    ).toEqual({
      errtype: "BoomError",
      message: "it broke",
      traceback: ["frame1", "frame2"],
    });
  });

  it("accepts an empty message and empty traceback", () => {
    expect(parseTaskError('{"errtype":"ValueError","message":"","traceback":[]}')).toEqual({
      errtype: "ValueError",
      message: "",
      traceback: [],
    });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseTaskError('  {"errtype":"E","message":"m","traceback":[]}\n')).toEqual({
      errtype: "E",
      message: "m",
      traceback: [],
    });
  });

  it("returns null for legacy plain strings", () => {
    expect(parseTaskError("ValueError: permanent failure")).toBeNull();
    expect(
      parseTaskError('Traceback (most recent call last):\n  File "x.py"\nValueError: boom'),
    ).toBeNull();
    expect(parseTaskError("timed out after 30000ms")).toBeNull();
  });

  it("returns null for JSON that is not an object", () => {
    expect(parseTaskError('["errtype","message"]')).toBeNull();
    expect(parseTaskError('"just a string"')).toBeNull();
    expect(parseTaskError("42")).toBeNull();
    expect(parseTaskError("null")).toBeNull();
  });

  it("returns null for objects without a string message", () => {
    expect(parseTaskError('{"errtype":"E","traceback":[]}')).toBeNull();
    expect(parseTaskError('{"errtype":"E","message":42,"traceback":[]}')).toBeNull();
    expect(parseTaskError('{"errtype":"E","message":null}')).toBeNull();
  });

  it("returns null for empty / null / undefined input", () => {
    expect(parseTaskError("")).toBeNull();
    expect(parseTaskError("   ")).toBeNull();
    expect(parseTaskError(null)).toBeNull();
    expect(parseTaskError(undefined)).toBeNull();
  });

  it("returns null for malformed JSON starting with a brace", () => {
    expect(parseTaskError('{"errtype": broken')).toBeNull();
  });

  it("defaults errtype when missing or malformed", () => {
    expect(parseTaskError('{"message":"m"}')?.errtype).toBe("Error");
    expect(parseTaskError('{"errtype":7,"message":"m"}')?.errtype).toBe("Error");
    expect(parseTaskError('{"errtype":"","message":"m"}')?.errtype).toBe("Error");
  });

  it("normalizes malformed tracebacks", () => {
    expect(parseTaskError('{"errtype":"E","message":"m"}')?.traceback).toEqual([]);
    expect(parseTaskError('{"errtype":"E","message":"m","traceback":"nope"}')?.traceback).toEqual(
      [],
    );
    expect(
      parseTaskError('{"errtype":"E","message":"m","traceback":["a",1,"b",null]}')?.traceback,
    ).toEqual(["a", "b"]);
  });
});

describe("taskErrorSummary", () => {
  it("joins errtype and message", () => {
    expect(taskErrorSummary({ errtype: "BoomError", message: "it broke", traceback: [] })).toBe(
      "BoomError: it broke",
    );
  });

  it("omits the separator for an empty message", () => {
    expect(taskErrorSummary({ errtype: "BoomError", message: "", traceback: [] })).toBe(
      "BoomError",
    );
  });
});

describe("taskErrorTooltip", () => {
  it("is just the summary when there is no traceback", () => {
    expect(taskErrorTooltip({ errtype: "E", message: "m", traceback: [] })).toBe("E: m");
  });

  it("appends the full traceback when short", () => {
    expect(taskErrorTooltip({ errtype: "E", message: "m", traceback: ["f1", "f2"] })).toBe(
      "E: m\n\nf1\nf2",
    );
  });

  it("keeps only the innermost frames of a long traceback", () => {
    const traceback = ["f1", "f2", "f3", "f4", "f5", "f6", "f7"];
    expect(taskErrorTooltip({ errtype: "E", message: "m", traceback })).toBe(
      "E: m\n\n…\nf3\nf4\nf5\nf6\nf7",
    );
  });
});
