import { describe, expect, it } from "vitest";
import type { DeadLetter } from "@/lib/api-types";
import { groupByError } from "./utils";

function dl(overrides: Partial<DeadLetter>): DeadLetter {
  return {
    id: overrides.id ?? "id-1",
    original_job_id: overrides.original_job_id ?? "job-1",
    task_name: overrides.task_name ?? "send_email",
    queue: overrides.queue ?? "default",
    error: overrides.error ?? null,
    retry_count: overrides.retry_count ?? 3,
    failed_at: overrides.failed_at ?? 1_700_000_000,
  };
}

describe("groupByError", () => {
  it("returns empty array when no items", () => {
    expect(groupByError([])).toEqual([]);
  });

  it("collapses entries with the same error into one group", () => {
    const items = [
      dl({ id: "a", error: "timeout", failed_at: 1000 }),
      dl({ id: "b", error: "timeout", failed_at: 2000 }),
      dl({ id: "c", error: "divide by zero", failed_at: 1500 }),
    ];
    const groups = groupByError(items);
    expect(groups).toHaveLength(2);
    const timeout = groups.find((g) => g.error === "timeout")!;
    expect(timeout.entries).toHaveLength(2);
  });

  it("sorts entries within a group newest-first", () => {
    const items = [
      dl({ id: "old", error: "oops", failed_at: 100 }),
      dl({ id: "new", error: "oops", failed_at: 900 }),
      dl({ id: "middle", error: "oops", failed_at: 500 }),
    ];
    const groups = groupByError(items);
    expect(groups[0]!.entries.map((e) => e.id)).toEqual(["new", "middle", "old"]);
  });

  it("orders groups by the freshest failure first", () => {
    const items = [
      dl({ id: "a", error: "E1", failed_at: 10 }),
      dl({ id: "b", error: "E2", failed_at: 50 }),
      dl({ id: "c", error: "E3", failed_at: 30 }),
    ];
    const groups = groupByError(items);
    expect(groups.map((g) => g.error)).toEqual(["E2", "E3", "E1"]);
  });

  it("treats null and whitespace-only errors as one labeled group", () => {
    const items = [dl({ id: "a", error: null }), dl({ id: "b", error: "   " })];
    const groups = groupByError(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.error).toMatch(/no error captured/i);
  });

  it("dedupes queues across entries in a group", () => {
    const items = [
      dl({ id: "a", error: "boom", queue: "emails" }),
      dl({ id: "b", error: "boom", queue: "emails" }),
      dl({ id: "c", error: "boom", queue: "reports" }),
    ];
    const [group] = groupByError(items);
    expect(group!.queues).toEqual(["emails", "reports"]);
  });
});
