import { Heart } from "lucide-react";
import { LiveDot, Skeleton } from "@/components/ui";
import type { QueueStats, TimeseriesBucket } from "@/lib/api-types";
import { formatCount } from "@/lib/number";

interface PulseProps {
  stats: QueueStats | undefined;
  throughput: TimeseriesBucket[] | undefined;
}

const Highlight = ({ children }: { children: React.ReactNode }) => (
  <span className="font-mono font-semibold text-[var(--accent-ink)]">{children}</span>
);

/**
 * The Overview's plain-language health banner — the personality moment. It
 * summarises the last hour in one sentence with mono-highlighted numbers, and
 * a status pill driven by the success rate + dead-letter count.
 */
export function Pulse({ stats, throughput }: PulseProps) {
  if (!stats) {
    return (
      <div className="rounded-[var(--card-radius)] border border-[var(--border)] bg-[var(--surface)] p-[var(--pad)] shadow-[var(--card-shadow)]">
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  const buckets = throughput ?? [];
  const lastHour = buckets.reduce((sum, b) => sum + b.count, 0);
  const failures = buckets.reduce((sum, b) => sum + b.failure, 0);
  const rate = lastHour > 0 ? ((lastHour - failures) / lastHour) * 100 : 100;
  const dead = stats.dead;
  const healthy = dead < 30 && rate > 98;

  return (
    <div
      className="flex items-center gap-4 rounded-[var(--card-radius)] border border-[var(--border)] p-[var(--pad)] shadow-[var(--card-shadow)]"
      style={{
        background: "linear-gradient(105deg, var(--accent-dim), transparent 46%), var(--surface)",
      }}
    >
      <div className="grid size-[46px] shrink-0 place-items-center rounded-[13px] border border-accent/30 bg-accent-dim text-accent">
        <Heart className="size-[22px]" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[1.02rem] font-medium leading-snug tracking-[-0.01em]">
          {lastHour === 0 ? (
            <>It's quiet right now — no jobs have run in the last hour.</>
          ) : (
            <>
              {healthy ? "Everything's flowing nicely — " : "Mostly steady — "}
              <Highlight>{formatCount(lastHour)}</Highlight> jobs ran in the last hour at a{" "}
              <Highlight>{rate.toFixed(1)}%</Highlight> success rate.
            </>
          )}
        </div>
        <div className="mt-1 text-[0.82rem] text-[var(--fg-muted)]">
          {formatCount(stats.running)} in flight right now · {formatCount(stats.pending)} waiting ·{" "}
          {formatCount(dead)} dead {dead === 1 ? "letter needs" : "letters need"} a look.
        </div>
      </div>
      <span
        className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-[7px] text-[0.82rem] font-semibold whitespace-nowrap ${
          healthy
            ? "border-success/30 bg-success-dim text-success"
            : "border-warning/30 bg-warning-dim text-warning"
        }`}
      >
        <LiveDot tone={healthy ? "success" : "warning"} size={7} />
        {healthy ? "All systems go" : "Keep an eye out"}
      </span>
    </div>
  );
}
