import type { DeadLetter } from "@/lib/api-types";
import { parseTaskError } from "@/lib/task-error";

export interface DeadLetterGroup {
  /** Stable key: `taskName::ExceptionClass`. */
  key: string;
  /** Task name shared across the group (distinct tasks go in distinct groups). */
  taskName: string;
  /** Exception class extracted from the traceback, or "Error" if unparseable. */
  exceptionClass: string;
  /** Queues represented in the group (deduped). */
  queues: string[];
  /** Distinct error messages seen across this group (deduped, newest-first). */
  reasons: string[];
  /** Most-recent failure timestamp in the group. */
  latestFailedAt: number;
  /** All dead letters in this group, newest first. */
  entries: DeadLetter[];
}

const EMPTY_ERROR_LABEL = "(no error captured)";
const UNKNOWN_EXCEPTION = "Error";

/**
 * Extract the exception class from an error string.
 *
 * Structured errors (canonical JSON per the cross-SDK contract) carry the
 * class in `errtype`. Legacy Python tracebacks end with a line like
 * ``ValueError: permanent failure…`` — we read the last non-blank line and
 * pull the token before the first `:`. Falls back to "Error" otherwise.
 */
export function extractExceptionClass(error: string | null | undefined): string {
  if (!error) return UNKNOWN_EXCEPTION;
  const structured = parseTaskError(error);
  if (structured) return structured.errtype;
  const trimmed = error.trim();
  if (!trimmed) return UNKNOWN_EXCEPTION;
  const lines = trimmed.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? "").trim();
    if (!line) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_.]*(?:Error|Exception|Warning))(?::|$)/);
    if (match?.[1]) return match[1];
    // Any colon-delimited identifier on the last non-blank line (best-effort).
    const fallback = line.match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*:/);
    if (fallback?.[1]) return fallback[1];
    break;
  }
  return UNKNOWN_EXCEPTION;
}

/**
 * Extract the one-line reason from a traceback — the text after the exception
 * class on the final traceback line (or `message` for structured errors).
 * Useful for a group's sub-summary.
 */
export function extractReason(error: string | null | undefined): string {
  if (!error) return EMPTY_ERROR_LABEL;
  const structured = parseTaskError(error);
  if (structured) return structured.message || EMPTY_ERROR_LABEL;
  const trimmed = error.trim();
  if (!trimmed) return EMPTY_ERROR_LABEL;
  const lines = trimmed.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = (lines[i] ?? "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx >= 0 && idx < line.length - 1) {
      return line.slice(idx + 1).trim() || line;
    }
    return line;
  }
  return EMPTY_ERROR_LABEL;
}

/**
 * Group dead letters by ``(task_name, exception class)``.
 *
 * Python tracebacks differ in their message text but share an exception
 * class — grouping on the class collapses "db timeout" / "bad payload" /
 * "schema drift" into a single actionable bucket. Individual reason strings
 * are surfaced as a sub-summary so the information isn't lost.
 */
export function groupByError(items: DeadLetter[]): DeadLetterGroup[] {
  const groups = new Map<string, DeadLetterGroup>();

  for (const item of items) {
    const exceptionClass = extractExceptionClass(item.error);
    const key = `${item.task_name}::${exceptionClass}`;
    const reason = extractReason(item.error);

    const existing = groups.get(key);
    if (existing) {
      existing.entries.push(item);
      if (!existing.queues.includes(item.queue)) existing.queues.push(item.queue);
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      if (item.failed_at > existing.latestFailedAt) existing.latestFailedAt = item.failed_at;
    } else {
      groups.set(key, {
        key,
        taskName: item.task_name,
        exceptionClass,
        queues: [item.queue],
        reasons: [reason],
        latestFailedAt: item.failed_at,
        entries: [item],
      });
    }
  }

  // Sort entries within each group newest-first, then sort groups by their
  // most-recent failure so the freshest problems surface first.
  for (const group of groups.values()) {
    group.entries.sort((a, b) => b.failed_at - a.failed_at);
  }
  return [...groups.values()].sort((a, b) => b.latestFailedAt - a.latestFailedAt);
}
