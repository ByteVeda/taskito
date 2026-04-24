import { describe, expect, it } from "vitest";
import { formatAbsolute, formatDuration, formatRelative } from "./time";

const PLACEHOLDER = "—";

describe("formatRelative", () => {
  it("formats recent timestamps", () => {
    const now = 1_700_000_000_000;
    const tenSecAgo = now - 10_000;
    expect(formatRelative(tenSecAgo, now)).toMatch(/10/);
  });

  it("returns placeholder for null / undefined", () => {
    expect(formatRelative(null)).toBe(PLACEHOLDER);
    expect(formatRelative(undefined)).toBe(PLACEHOLDER);
  });

  it("returns placeholder for 0 (unset sentinel from backend)", () => {
    expect(formatRelative(0)).toBe(PLACEHOLDER);
  });

  it("returns placeholder for NaN / invalid strings", () => {
    expect(formatRelative(Number.NaN)).toBe(PLACEHOLDER);
    expect(formatRelative("not a date")).toBe(PLACEHOLDER);
  });
});

describe("formatAbsolute", () => {
  it("returns placeholder for null / 0 / NaN", () => {
    expect(formatAbsolute(null)).toBe(PLACEHOLDER);
    expect(formatAbsolute(0)).toBe(PLACEHOLDER);
    expect(formatAbsolute(Number.NaN)).toBe(PLACEHOLDER);
  });

  it("formats valid numbers", () => {
    expect(formatAbsolute(1_700_000_000_000)).not.toBe(PLACEHOLDER);
  });
});

describe("formatDuration", () => {
  it("returns placeholder for null / negative / NaN", () => {
    expect(formatDuration(null)).toBe(PLACEHOLDER);
    expect(formatDuration(undefined)).toBe(PLACEHOLDER);
    expect(formatDuration(-1)).toBe(PLACEHOLDER);
    expect(formatDuration(Number.NaN)).toBe(PLACEHOLDER);
  });

  it("formats milliseconds, seconds, minutes, hours", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(1_500)).toMatch(/1\.50?s/);
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(3_720_000)).toBe("1h 2m");
  });
});
