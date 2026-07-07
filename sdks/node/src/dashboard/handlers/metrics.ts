// Aggregate the core's per-execution metric rows into the SPA's per-task and
// time-bucketed shapes. The core records a metric for every finished job.

import type { Metric } from "../../types";

export interface TaskMetrics {
  count: number;
  success_count: number;
  failure_count: number;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  min_ms: number;
  max_ms: number;
}

export interface TimeseriesBucket {
  timestamp: number;
  count: number;
  success: number;
  failure: number;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
}

function avg(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/** Nearest-rank percentile over an ascending-sorted list. */
function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  // Nearest-rank: ceil(p/100 * n) - 1, clamped into [0, n-1].
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.min(sorted.length - 1, Math.max(0, rank));
  return sorted[index] ?? 0;
}

export function aggregateByTask(rows: Metric[]): Record<string, TaskMetrics> {
  const durations = new Map<string, number[]>();
  const successes = new Map<string, number>();
  for (const row of rows) {
    const list = durations.get(row.taskName) ?? [];
    list.push(row.wallTimeNs / 1e6);
    durations.set(row.taskName, list);
    if (row.succeeded) {
      successes.set(row.taskName, (successes.get(row.taskName) ?? 0) + 1);
    }
  }

  const out: Record<string, TaskMetrics> = {};
  for (const [task, list] of durations) {
    list.sort((a, b) => a - b);
    const count = list.length;
    const success = successes.get(task) ?? 0;
    out[task] = {
      count,
      success_count: success,
      failure_count: count - success,
      avg_ms: avg(list),
      p50_ms: pct(list, 50),
      p95_ms: pct(list, 95),
      p99_ms: pct(list, 99),
      min_ms: list[0] ?? 0,
      max_ms: list[count - 1] ?? 0,
    };
  }
  return out;
}

export function bucketTimeseries(rows: Metric[], bucketMs: number): TimeseriesBucket[] {
  const buckets = new Map<number, { durations: number[]; success: number }>();
  for (const row of rows) {
    const ts = Math.floor(row.recordedAt / bucketMs) * bucketMs;
    const bucket = buckets.get(ts) ?? { durations: [], success: 0 };
    bucket.durations.push(row.wallTimeNs / 1e6);
    if (row.succeeded) {
      bucket.success += 1;
    }
    buckets.set(ts, bucket);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([timestamp, bucket]) => {
      const sorted = bucket.durations.sort((a, b) => a - b);
      return {
        timestamp,
        count: sorted.length,
        success: bucket.success,
        failure: sorted.length - bucket.success,
        avg_ms: avg(sorted),
        p50_ms: pct(sorted, 50),
        p95_ms: pct(sorted, 95),
        p99_ms: pct(sorted, 99),
      };
    });
}
