// Retention route handler. Echoes the windows the elected cleaner published for
// this namespace, so the dashboard can explain why rows disappear from its
// listings. Retention runs in the worker process, so this is never computed
// from local config — an unreported policy is reported as such.

import type { Queue } from "../../index";
import type { EffectiveRetention } from "../../types";

/** Every table's window in ms, `null` for keep-forever and unreported. */
function windowsToContract(snapshot: EffectiveRetention | null) {
  const windows = snapshot?.windows;
  return {
    task_logs_ttl_ms: windows?.taskLogs ?? null,
    archived_jobs_ttl_ms: windows?.archivedJobs ?? null,
    job_errors_ttl_ms: windows?.jobErrors ?? null,
    task_metrics_ttl_ms: windows?.taskMetrics ?? null,
    dead_letter_ttl_ms: windows?.deadLetter ?? null,
  };
}

/** The published retention policy for this queue's namespace. */
export function retention(queue: Queue) {
  const snapshot = queue.effectiveRetention();
  return {
    // Distinct from `enabled`: no worker has swept yet, so nothing is known
    // about the policy — not the same as retention being switched off.
    reported: snapshot !== null,
    enabled: snapshot?.enabled ?? false,
    defaulted: snapshot?.defaulted ?? false,
    namespace: snapshot?.namespace ?? null,
    reported_at: snapshot?.reportedAt ?? null,
    windows: windowsToContract(snapshot),
  };
}

/** Preview what a purge would delete under the reported policy (recommended
 *  defaults when unreported), computed in-process, so it always answers. */
export async function retentionDryRun(queue: Queue) {
  const preview = await queue.dryRunRetention();
  return {
    enabled: preview.enabled,
    defaulted: preview.defaulted,
    namespace: preview.namespace,
    reference_time: preview.referenceTime,
    windows: {
      task_logs_ttl_ms: preview.windows.taskLogs,
      archived_jobs_ttl_ms: preview.windows.archivedJobs,
      job_errors_ttl_ms: preview.windows.jobErrors,
      task_metrics_ttl_ms: preview.windows.taskMetrics,
      dead_letter_ttl_ms: preview.windows.deadLetter,
    },
    counts: {
      task_logs: preview.counts.taskLogs,
      archived_jobs: preview.counts.archivedJobs,
      job_errors: preview.counts.jobErrors,
      task_metrics: preview.counts.taskMetrics,
      dead_letter: preview.counts.deadLetter,
    },
    total: preview.total,
  };
}
