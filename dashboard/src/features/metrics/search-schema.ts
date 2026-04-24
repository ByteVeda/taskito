import * as v from "valibot";
import { DEFAULT_TIME_RANGE, TIME_RANGES, type TimeRange } from "./types";

const TIME_RANGE_VALUES = TIME_RANGES.map((r) => r.value) as unknown as readonly [
  TimeRange,
  ...TimeRange[],
];

/**
 * Schema for `/metrics` URL search params.
 *
 * Promoting `range` and `task` to the URL so dashboards can be deep-linked
 * to a specific view (e.g. "send_email, last 24h"). Defaults collapse to
 * the canonical home state.
 */
export const metricsSearchSchema = v.object({
  range: v.picklist(TIME_RANGE_VALUES),
  task: v.optional(v.string()),
});

export type MetricsSearch = v.InferOutput<typeof metricsSearchSchema>;

/**
 * Normalize raw search-param input into a valid `MetricsSearch`. Unknown
 * ranges fall back to the default; empty task strings drop to undefined.
 */
export function parseMetricsSearch(raw: Record<string, unknown>): MetricsSearch {
  const range = TIME_RANGE_VALUES.find((r) => r === raw.range) ?? DEFAULT_TIME_RANGE;
  const task = typeof raw.task === "string" && raw.task.trim() !== "" ? raw.task.trim() : undefined;
  return v.parse(metricsSearchSchema, { range, task });
}
