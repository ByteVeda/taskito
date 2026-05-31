import { ListFilter } from "lucide-react";
import { useMemo } from "react";
import { Card, CardContent, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import type { InterceptionStats } from "@/lib/api-types";
import { formatCount } from "@/lib/number";
import { TONE_VAR, type Tone } from "@/lib/status";
import { formatDuration } from "@/lib/time";

interface InterceptionTableProps {
  stats: InterceptionStats | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

const STRATEGY_LABEL: Record<string, string> = {
  reconstruct: "Reconstruct",
  passthrough: "Passthrough",
  deny: "Deny",
  pass: "Pass",
  convert: "Convert",
  proxy: "Proxy",
  redirect: "Redirect",
  reject: "Reject",
};

/** Fixed tones for known strategies; unknown keys cycle these fallbacks. */
const STRATEGY_TONE: Record<string, Tone> = {
  reconstruct: "accent",
  passthrough: "info",
  deny: "danger",
};
const FALLBACK_TONES: Tone[] = ["warning", "success", "info", "accent"];

interface StrategySegment {
  key: string;
  count: number;
  share: number;
  tone: Tone;
}

export function InterceptionTable({ stats, loading, error, onRetry }: InterceptionTableProps) {
  const segments = useMemo<StrategySegment[]>(() => {
    if (!stats?.strategy_counts) return [];
    const entries = Object.entries(stats.strategy_counts).filter(([, count]) => count > 0);
    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    let fallback = 0;
    return entries
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({
        key,
        count,
        share: total > 0 ? count / total : 0,
        tone: STRATEGY_TONE[key] ?? FALLBACK_TONES[fallback++ % FALLBACK_TONES.length] ?? "neutral",
      }));
  }, [stats]);

  if (error) {
    return (
      <ErrorState
        title="Couldn't load interception stats"
        description={error.message}
        onRetry={onRetry}
      />
    );
  }
  if (loading && !stats) {
    return <Skeleton className="h-40 w-full" />;
  }
  if (!stats || stats.total_intercepts === 0) {
    return (
      <EmptyState
        icon={ListFilter}
        title="No interceptions recorded"
        description="Strategy stats appear once arguments hit interception rules."
      />
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-[var(--gap)]">
        <div className="grid grid-cols-3 gap-2">
          <Meta label="Total intercepts" value={formatCount(stats.total_intercepts)} />
          <Meta label="Avg duration" value={formatDuration(stats.avg_duration_ms)} />
          <Meta label="Max depth" value={String(stats.max_depth_reached)} />
        </div>

        <div className="flex flex-col gap-2.5">
          <div className="text-xs text-[var(--fg-muted)]">Strategy breakdown</div>
          <div className="flex h-3 overflow-hidden rounded-full bg-[var(--surface-3)]">
            {segments.map((s) => (
              <span
                key={s.key}
                className="h-full first:rounded-l-full last:rounded-r-full"
                style={{ width: `${s.share * 100}%`, background: TONE_VAR[s.tone] }}
                title={`${STRATEGY_LABEL[s.key] ?? s.key}: ${s.count}`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {segments.map((s) => (
              <span
                key={s.key}
                className="inline-flex items-center gap-1.5 text-xs text-[var(--fg-muted)]"
              >
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: TONE_VAR[s.tone] }}
                  aria-hidden
                />
                {STRATEGY_LABEL[s.key] ?? s.key} ·{" "}
                <span className="font-mono tabular-nums text-[var(--fg)]">
                  {formatCount(s.count)}
                </span>
              </span>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[0.68rem] uppercase tracking-wide text-[var(--fg-subtle)]">
        {label}
      </span>
      <span className="font-mono text-[1.05rem] font-semibold tabular-nums text-[var(--fg)]">
        {value}
      </span>
    </div>
  );
}
