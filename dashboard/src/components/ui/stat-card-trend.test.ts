import { describe, expect, it } from "vitest";
import { computeTrend, trendToneClass } from "./stat-card-trend";

describe("trendToneClass", () => {
  it("renders flat as muted regardless of upIsGood", () => {
    expect(trendToneClass("flat", true)).toMatch(/fg-subtle/);
    expect(trendToneClass("flat", false)).toMatch(/fg-subtle/);
  });

  it("treats up as success when upIsGood", () => {
    expect(trendToneClass("up", true)).toBe("text-success");
    expect(trendToneClass("down", true)).toBe("text-danger");
  });

  it("inverts when upIsGood is false", () => {
    expect(trendToneClass("up", false)).toBe("text-danger");
    expect(trendToneClass("down", false)).toBe("text-success");
  });
});

describe("computeTrend", () => {
  it("returns null on non-finite input", () => {
    expect(computeTrend(Number.NaN, 5)).toBeNull();
    expect(computeTrend(5, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("returns flat when current and previous are both zero", () => {
    expect(computeTrend(0, 0)).toEqual({ direction: "flat", label: "0%", upIsGood: undefined });
  });

  it("returns 'new' when previous is zero and current is non-zero", () => {
    const t = computeTrend(7, 0);
    expect(t?.direction).toBe("up");
    expect(t?.label).toBe("new");
  });

  it("computes positive percentage", () => {
    expect(computeTrend(120, 100)).toEqual({ direction: "up", label: "+20%", upIsGood: undefined });
  });

  it("computes negative percentage", () => {
    expect(computeTrend(80, 100)).toEqual({
      direction: "down",
      label: "-20%",
      upIsGood: undefined,
    });
  });

  it("returns flat when rounded percentage is zero", () => {
    expect(computeTrend(1001, 1000)?.direction).toBe("flat");
  });

  it("threads upIsGood through", () => {
    const t = computeTrend(120, 100, { upIsGood: false });
    expect(t?.upIsGood).toBe(false);
  });
});
