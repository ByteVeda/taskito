import { describe, expect, it } from "vitest";
import type { DeadLetter } from "@/lib/api-types";
import { extractExceptionClass, extractReason, groupByError } from "./utils";

function dl(overrides: Partial<DeadLetter>): DeadLetter {
  return {
    id: overrides.id ?? "id-1",
    original_job_id: overrides.original_job_id ?? "job-1",
    task_name: overrides.task_name ?? "send_email",
    queue: overrides.queue ?? "default",
    error: overrides.error ?? null,
    retry_count: overrides.retry_count ?? 3,
    failed_at: overrides.failed_at ?? 1_700_000_000_000,
  };
}

const TRACEBACK_VALUE_ERROR = `Traceback (most recent call last):
  File "demo.py", line 100, in hard_fail
    raise ValueError(f"permanent failure: {reason}")
ValueError: permanent failure: db timeout`;

const TRACEBACK_BAD_PAYLOAD = `Traceback (most recent call last):
  File "demo.py", line 100, in hard_fail
    raise ValueError(f"permanent failure: {reason}")
ValueError: permanent failure: bad payload`;

const TRACEBACK_CONNECTION_ERROR = `Traceback (most recent call last):
  File "demo.py", line 115, in external_api_call
    raise ConnectionError(f"upstream {endpoint} unreachable")
ConnectionError: upstream /v1/users unreachable`;

describe("extractExceptionClass", () => {
  it("pulls the class name from a standard traceback", () => {
    expect(extractExceptionClass(TRACEBACK_VALUE_ERROR)).toBe("ValueError");
    expect(extractExceptionClass(TRACEBACK_CONNECTION_ERROR)).toBe("ConnectionError");
  });

  it("handles custom exception class names", () => {
    const traceback = "something\nMyCustomError: oops";
    expect(extractExceptionClass(traceback)).toBe("MyCustomError");
  });

  it("falls back to Error on unparseable input", () => {
    expect(extractExceptionClass(null)).toBe("Error");
    expect(extractExceptionClass("")).toBe("Error");
    expect(extractExceptionClass("some random text")).toBe("Error");
  });
});

describe("extractReason", () => {
  it("returns the message after the class on the last line", () => {
    expect(extractReason(TRACEBACK_VALUE_ERROR)).toBe("permanent failure: db timeout");
  });

  it("returns the whole line when there's no colon", () => {
    expect(extractReason("something broke")).toBe("something broke");
  });

  it("placeholders null/empty", () => {
    expect(extractReason(null)).toMatch(/no error captured/i);
    expect(extractReason("   ")).toMatch(/no error captured/i);
  });
});

describe("groupByError", () => {
  it("returns empty for empty input", () => {
    expect(groupByError([])).toEqual([]);
  });

  it("groups same-task same-exception-class failures together", () => {
    const items = [
      dl({ id: "a", task_name: "hard_fail", error: TRACEBACK_VALUE_ERROR }),
      dl({ id: "b", task_name: "hard_fail", error: TRACEBACK_BAD_PAYLOAD }),
    ];
    const groups = groupByError(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe("hard_fail::ValueError");
    expect(groups[0]!.entries).toHaveLength(2);
    expect(groups[0]!.reasons).toContain("permanent failure: db timeout");
    expect(groups[0]!.reasons).toContain("permanent failure: bad payload");
  });

  it("separates different tasks even when the exception class matches", () => {
    const items = [
      dl({ id: "a", task_name: "hard_fail", error: TRACEBACK_VALUE_ERROR }),
      dl({ id: "b", task_name: "other_task", error: TRACEBACK_VALUE_ERROR }),
    ];
    const groups = groupByError(items);
    expect(groups).toHaveLength(2);
  });

  it("separates different exception classes in the same task", () => {
    const items = [
      dl({ id: "a", task_name: "f", error: TRACEBACK_VALUE_ERROR }),
      dl({ id: "b", task_name: "f", error: TRACEBACK_CONNECTION_ERROR }),
    ];
    const groups = groupByError(items);
    expect(groups).toHaveLength(2);
  });

  it("sorts entries within a group newest-first", () => {
    const items = [
      dl({ id: "old", error: TRACEBACK_VALUE_ERROR, failed_at: 100 }),
      dl({ id: "new", error: TRACEBACK_VALUE_ERROR, failed_at: 900 }),
    ];
    const [group] = groupByError(items);
    expect(group!.entries.map((e) => e.id)).toEqual(["new", "old"]);
    expect(group!.latestFailedAt).toBe(900);
  });

  it("orders groups by freshest failure first", () => {
    const items = [
      dl({ id: "a", task_name: "t1", error: TRACEBACK_VALUE_ERROR, failed_at: 10 }),
      dl({ id: "b", task_name: "t2", error: TRACEBACK_VALUE_ERROR, failed_at: 50 }),
      dl({ id: "c", task_name: "t3", error: TRACEBACK_VALUE_ERROR, failed_at: 30 }),
    ];
    const groups = groupByError(items);
    expect(groups.map((g) => g.taskName)).toEqual(["t2", "t3", "t1"]);
  });

  it("dedupes queues across entries in a group", () => {
    const items = [
      dl({ id: "a", queue: "emails", error: TRACEBACK_VALUE_ERROR }),
      dl({ id: "b", queue: "emails", error: TRACEBACK_VALUE_ERROR }),
      dl({ id: "c", queue: "reports", error: TRACEBACK_VALUE_ERROR }),
    ];
    const [group] = groupByError(items);
    expect(group!.queues).toEqual(["emails", "reports"]);
  });
});
