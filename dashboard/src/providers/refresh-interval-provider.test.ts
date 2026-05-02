import { describe, expect, it } from "vitest";
import { parseRefreshOption, refreshIntervalMs } from "./refresh-interval-provider";

describe("parseRefreshOption", () => {
  it("returns each known option verbatim", () => {
    expect(parseRefreshOption("2s")).toBe("2s");
    expect(parseRefreshOption("5s")).toBe("5s");
    expect(parseRefreshOption("10s")).toBe("10s");
    expect(parseRefreshOption("off")).toBe("off");
  });

  it("falls back to 5s when storage is empty", () => {
    expect(parseRefreshOption(null)).toBe("5s");
    expect(parseRefreshOption("")).toBe("5s");
  });

  it("falls back to 5s on unknown values", () => {
    expect(parseRefreshOption("3s")).toBe("5s");
    expect(parseRefreshOption("nonsense")).toBe("5s");
    expect(parseRefreshOption("0")).toBe("5s");
  });

  it("is case-sensitive — does not normalise casing or whitespace", () => {
    expect(parseRefreshOption("2S")).toBe("5s");
    expect(parseRefreshOption("OFF")).toBe("5s");
    expect(parseRefreshOption(" 2s")).toBe("5s");
    expect(parseRefreshOption("2s ")).toBe("5s");
  });
});

describe("refreshIntervalMs", () => {
  it("maps each option to its polling interval", () => {
    expect(refreshIntervalMs("2s")).toBe(2_000);
    expect(refreshIntervalMs("5s")).toBe(5_000);
    expect(refreshIntervalMs("10s")).toBe(10_000);
  });

  it("returns false for off so consumers can disable polling", () => {
    expect(refreshIntervalMs("off")).toBe(false);
  });
});
