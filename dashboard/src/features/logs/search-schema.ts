import * as v from "valibot";
import { LOG_LEVELS } from "./api";

/**
 * Default window + page size for the logs feed. Kept here so the route
 * loader and the page component build identical `LogsQuery` shapes — same
 * query key, same cache hit.
 */
export const LOGS_DEFAULT_SINCE_SECONDS = 3_600;
export const LOGS_PAGE_SIZE = 500;

/**
 * Schema for `/logs` URL search params.
 *
 * Promotes the previously-local filter state (task, level) to the URL so
 * filter combinations are shareable and survive refresh. `sinceSeconds` and
 * `limit` stay non-URL for now — they aren't user-tuned today.
 */
export const logsSearchSchema = v.object({
  task: v.optional(v.string()),
  level: v.optional(v.picklist(LOG_LEVELS)),
});

export type LogsSearch = v.InferOutput<typeof logsSearchSchema>;

/**
 * Normalize raw search-param input into a valid `LogsSearch`. Invalid values
 * are silently dropped so a hand-typed URL never blanks the page.
 */
export function parseLogsSearch(raw: Record<string, unknown>): LogsSearch {
  const task = typeof raw.task === "string" && raw.task.trim() !== "" ? raw.task.trim() : undefined;
  const level = LOG_LEVELS.find((l) => l === raw.level);
  return v.parse(logsSearchSchema, { task, level });
}
