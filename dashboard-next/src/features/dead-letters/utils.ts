import type { DeadLetter } from "@/lib/api-types";

export interface DeadLetterGroup {
  /** Canonical error message shared by every entry in the group. */
  error: string;
  /** Sample task name used as the group label. */
  sampleTask: string;
  /** Queues represented in the group (deduped). */
  queues: string[];
  /** All dead letters in this group, newest first. */
  entries: DeadLetter[];
}

const EMPTY_ERROR_LABEL = "(no error captured)";

/**
 * Group dead letters by error message.
 *
 * Items with the same error are collapsed into a single group so an operator
 * isn't drowning in 500 identical SQL timeouts. Groups are returned ordered
 * by most recent failure first.
 */
export function groupByError(items: DeadLetter[]): DeadLetterGroup[] {
  const byError = new Map<string, DeadLetterGroup>();
  for (const item of items) {
    const key = (item.error ?? "").trim() || EMPTY_ERROR_LABEL;
    const existing = byError.get(key);
    if (existing) {
      existing.entries.push(item);
      if (!existing.queues.includes(item.queue)) existing.queues.push(item.queue);
    } else {
      byError.set(key, {
        error: key,
        sampleTask: item.task_name,
        queues: [item.queue],
        entries: [item],
      });
    }
  }
  // Ensure entries within a group are newest-first, then order groups by
  // the most recent failure across all entries.
  for (const group of byError.values()) {
    group.entries.sort((a, b) => b.failed_at - a.failed_at);
  }
  return [...byError.values()].sort(
    (a, b) => (b.entries[0]?.failed_at ?? 0) - (a.entries[0]?.failed_at ?? 0),
  );
}
