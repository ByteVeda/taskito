import type { ReactNode } from "react";

// Crash-recovery timeline — ports the prototype's `.timeline` (`.tl`/`.tt`/`.tb`).
// `architecture/failure-model.mdx`.
const STEPS: { at: string; body: ReactNode }[] = [
  {
    at: "t = 0s",
    body: (
      <>
        Worker claims a job — status <b>pending → running</b>,{" "}
        <code>started_at</code> recorded.
      </>
    ),
  },
  {
    at: "t = crash",
    body: (
      <>
        Worker dies mid-task. The row is left in <b>running</b> with no result.
      </>
    ),
  },
  {
    at: "t = timeout_ms",
    body: (
      <>
        The stale reaper (runs ~every 5s) finds the job has exceeded{" "}
        <code>timeout_ms</code> and marks it <b>failed</b>.
      </>
    ),
  },
  {
    at: "t + retry",
    body: (
      <>
        If retries remain → re-enqueued as <b>pending</b> with backoff.
        Otherwise → <b>dead-letter</b>.
      </>
    ),
  },
];

export function CrashRecoveryTimeline() {
  return (
    <div className="timeline">
      {STEPS.map((s) => (
        <div className="tl" key={s.at}>
          <div className="tt">{s.at}</div>
          <div className="tb">{s.body}</div>
        </div>
      ))}
    </div>
  );
}
