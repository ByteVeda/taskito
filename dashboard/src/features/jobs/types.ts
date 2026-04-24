import type { JobStatus } from "@/lib/api-types";

/**
 * Filter criteria for listing jobs. Every field is optional and narrowing
 * — pagination lives alongside so a single `JobListQuery` round-trips
 * through the URL search params.
 */
export interface JobFilters {
  status?: JobStatus;
  queue?: string;
  task?: string;
  metadata?: string;
  error?: string;
  createdAfter?: number;
  createdBefore?: number;
}

export interface JobListQuery extends JobFilters {
  page: number;
  pageSize: number;
}
