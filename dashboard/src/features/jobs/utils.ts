import type { JobStatus } from "@/lib/api-types";
import type { JobFilters, JobListQuery } from "./types";

const STATUS_VALUES: readonly JobStatus[] = [
  "pending",
  "running",
  "complete",
  "failed",
  "dead",
  "cancelled",
] as const;

const DEFAULT_PAGE_SIZE = 25;

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function asNonNegativeInteger(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  const int = Math.floor(n);
  return int >= 0 ? int : undefined;
}

function asJobStatus(value: unknown): JobStatus | undefined {
  return STATUS_VALUES.find((s) => s === value);
}

/**
 * Parse raw search params (from TanStack Router's `validateSearch`) into a
 * strongly-typed query. Missing/invalid fields are dropped silently so deep
 * links never crash the route — an over-strict parser would be a footgun.
 */
export function parseJobListSearch(raw: Record<string, unknown>): JobListQuery {
  return {
    status: asJobStatus(raw.status),
    queue: asTrimmedString(raw.queue),
    task: asTrimmedString(raw.task),
    metadata: asTrimmedString(raw.metadata),
    error: asTrimmedString(raw.error),
    createdAfter: asNonNegativeInteger(raw.createdAfter),
    createdBefore: asNonNegativeInteger(raw.createdBefore),
    page: asNonNegativeInteger(raw.page) ?? 0,
    pageSize: Math.min(Math.max(asNonNegativeInteger(raw.pageSize) ?? DEFAULT_PAGE_SIZE, 10), 200),
  };
}

/**
 * Map a `JobListQuery` to the `/api/jobs` query-string shape understood by
 * the Python dashboard handler. Empty fields are omitted so the URL stays
 * clean.
 */
export function toApiParams(query: JobListQuery): Record<string, string | number> {
  const params: Record<string, string | number> = {
    limit: query.pageSize,
    offset: query.page * query.pageSize,
  };
  if (query.status) params.status = query.status;
  if (query.queue) params.queue = query.queue;
  if (query.task) params.task = query.task;
  if (query.metadata) params.metadata = query.metadata;
  if (query.error) params.error = query.error;
  if (query.createdAfter != null) params.created_after = query.createdAfter;
  if (query.createdBefore != null) params.created_before = query.createdBefore;
  return params;
}

export function countActiveFilters(filters: JobFilters): number {
  let n = 0;
  if (filters.status) n++;
  if (filters.queue) n++;
  if (filters.task) n++;
  if (filters.metadata) n++;
  if (filters.error) n++;
  if (filters.createdAfter != null) n++;
  if (filters.createdBefore != null) n++;
  return n;
}

const TERMINAL_STATUSES = new Set<JobStatus>(["complete", "failed", "dead", "cancelled"]);

export function isTerminalStatus(status: JobStatus | undefined): boolean {
  if (!status) return false;
  return TERMINAL_STATUSES.has(status);
}

export function canCancel(status: JobStatus | undefined): boolean {
  return status === "pending" || status === "running";
}

export function canReplay(status: JobStatus | undefined): boolean {
  if (!status) return false;
  return TERMINAL_STATUSES.has(status);
}
