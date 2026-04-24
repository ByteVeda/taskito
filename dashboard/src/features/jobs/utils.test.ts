import { describe, expect, it } from "vitest";
import {
  canCancel,
  canReplay,
  countActiveFilters,
  isTerminalStatus,
  parseJobListSearch,
  toApiParams,
} from "./utils";

describe("parseJobListSearch", () => {
  it("returns defaults when search is empty", () => {
    const result = parseJobListSearch({});
    expect(result.page).toBe(0);
    expect(result.pageSize).toBe(25);
    expect(result.status).toBeUndefined();
  });

  it("drops invalid status values silently", () => {
    const result = parseJobListSearch({ status: "bogus" });
    expect(result.status).toBeUndefined();
  });

  it("preserves valid status values", () => {
    const result = parseJobListSearch({ status: "running" });
    expect(result.status).toBe("running");
  });

  it("trims and drops empty strings", () => {
    const result = parseJobListSearch({ queue: "   ", task: "send_email" });
    expect(result.queue).toBeUndefined();
    expect(result.task).toBe("send_email");
  });

  it("clamps page size", () => {
    expect(parseJobListSearch({ pageSize: 5 }).pageSize).toBe(10);
    expect(parseJobListSearch({ pageSize: 9999 }).pageSize).toBe(200);
  });

  it("rejects negative page numbers", () => {
    const result = parseJobListSearch({ page: -5 });
    expect(result.page).toBe(0);
  });
});

describe("toApiParams", () => {
  it("computes offset from page + pageSize", () => {
    const p = toApiParams({ page: 2, pageSize: 25 });
    expect(p.offset).toBe(50);
    expect(p.limit).toBe(25);
  });

  it("omits absent filters", () => {
    const p = toApiParams({ page: 0, pageSize: 20 });
    expect(p).not.toHaveProperty("status");
    expect(p).not.toHaveProperty("queue");
  });

  it("maps camelCase filter names to snake_case params", () => {
    const p = toApiParams({
      page: 0,
      pageSize: 20,
      createdAfter: 1700,
      createdBefore: 1800,
    });
    expect(p).toMatchObject({ created_after: 1700, created_before: 1800 });
  });
});

describe("countActiveFilters", () => {
  it("counts only populated filters", () => {
    expect(countActiveFilters({})).toBe(0);
    expect(countActiveFilters({ status: "running" })).toBe(1);
    expect(
      countActiveFilters({
        status: "failed",
        queue: "emails",
        createdAfter: 123,
      }),
    ).toBe(3);
  });
});

describe("status helpers", () => {
  it("treats complete/failed/dead/cancelled as terminal", () => {
    expect(isTerminalStatus("complete")).toBe(true);
    expect(isTerminalStatus("failed")).toBe(true);
    expect(isTerminalStatus("dead")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("pending")).toBe(false);
    expect(isTerminalStatus("running")).toBe(false);
  });

  it("canCancel only for pending/running", () => {
    expect(canCancel("pending")).toBe(true);
    expect(canCancel("running")).toBe(true);
    expect(canCancel("complete")).toBe(false);
    expect(canCancel(undefined)).toBe(false);
  });

  it("canReplay only for terminal states", () => {
    expect(canReplay("complete")).toBe(true);
    expect(canReplay("failed")).toBe(true);
    expect(canReplay("dead")).toBe(true);
    expect(canReplay("cancelled")).toBe(true);
    expect(canReplay("pending")).toBe(false);
    expect(canReplay("running")).toBe(false);
    expect(canReplay(undefined)).toBe(false);
  });
});
