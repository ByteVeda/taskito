import * as v from "valibot";
import type { JobStatus } from "@/lib/api-types";

/**
 * Ordered list of valid job statuses. Exported so UI components (filters,
 * dropdowns) can reuse the same set as the search-param validator.
 */
export const JOB_STATUS_VALUES = [
  "pending",
  "running",
  "complete",
  "failed",
  "dead",
  "cancelled",
] as const satisfies readonly JobStatus[];

/**
 * Schema for the filter fields — everything you might narrow a job query by
 * except pagination. Reused by the list-search schema below so filters and
 * pagination stay in lock-step.
 */
export const jobFiltersSchema = v.object({
  status: v.optional(v.picklist(JOB_STATUS_VALUES)),
  queue: v.optional(v.string()),
  task: v.optional(v.string()),
  metadata: v.optional(v.string()),
  error: v.optional(v.string()),
  createdAfter: v.optional(v.number()),
  createdBefore: v.optional(v.number()),
});

/**
 * Schema for the full `/jobs` URL search params: filters + pagination.
 *
 * `pageSize` is clamped to [10, 200] so a malformed deep link cannot force a
 * 10k-row fetch. `validateSearch` on the route rejects inputs that escape
 * this range after normalization, which is treated as a programmer error.
 */
export const jobListSearchSchema = v.object({
  ...jobFiltersSchema.entries,
  page: v.pipe(v.number(), v.integer(), v.minValue(0)),
  pageSize: v.pipe(v.number(), v.integer(), v.minValue(10), v.maxValue(200)),
});
