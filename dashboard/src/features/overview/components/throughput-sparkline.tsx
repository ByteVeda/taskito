import { useId, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, ErrorState, Skeleton } from "@/components/ui";
import type { TimeseriesBucket } from "@/lib/api-types";
import { formatCount } from "@/lib/number";
import { formatRelative } from "@/lib/time";

interface ThroughputSparklineProps {
  buckets: TimeseriesBucket[] | undefined;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}

function Legend() {
  return (
    <div className="flex items-center gap-4">
      <span className="inline-flex items-center gap-1.5 text-[0.76rem] text-[var(--fg-muted)]">
        <i className="size-2.5 rounded-[3px] bg-accent" />
        runs
      </span>
      <span className="inline-flex items-center gap-1.5 text-[0.76rem] text-[var(--fg-muted)]">
        <i className="size-2.5 rounded-[3px] bg-danger" />
        failures
      </span>
    </div>
  );
}

export function ThroughputSparkline({
  buckets,
  loading,
  error,
  onRetry,
}: ThroughputSparklineProps) {
  const points = useMemo(() => buckets ?? [], [buckets]);
  const total = useMemo(() => points.reduce((sum, b) => sum + b.count, 0), [points]);
  const peak = useMemo(() => points.reduce((max, b) => Math.max(max, b.count), 0), [points]);

  if (error) {
    return (
      <ErrorState title="Couldn't load throughput" description={error.message} onRetry={onRetry} />
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <CardTitle>Throughput — last hour</CardTitle>
        <div className="flex flex-wrap items-center gap-4">
          <Legend />
          {loading ? (
            <Skeleton className="h-4 w-24" />
          ) : (
            <span className="text-[0.76rem] tabular-nums text-[var(--fg-subtle)]">
              {formatCount(total)} runs · peak {formatCount(peak)}/min
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[150px] w-full" />
        ) : points.length === 0 ? (
          <div className="grid h-[150px] place-items-center text-xs text-[var(--fg-subtle)]">
            No activity in this window
          </div>
        ) : (
          <AreaChart buckets={points} />
        )}
      </CardContent>
    </Card>
  );
}

const CHART_WIDTH = 1000;
const CHART_HEIGHT = 150;

function AreaChart({ buckets }: { buckets: TimeseriesBucket[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  // Unique per instance so multiple charts don't share one gradient <defs>.
  const gradientId = `throughput-fill-${useId().replace(/:/g, "")}`;

  // Geometry depends only on the data — recompute on new buckets, not on hover.
  const { areaPath, runsPath, failPath } = useMemo(() => {
    const maxCount = Math.max(1, ...buckets.map((b) => b.count));
    const step = buckets.length > 1 ? CHART_WIDTH / (buckets.length - 1) : 0;
    const toY = (v: number) => CHART_HEIGHT - (v / maxCount) * (CHART_HEIGHT - 8) - 4;
    const toPath = (field: "count" | "failure") =>
      buckets
        .map(
          (b, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${toY(b[field]).toFixed(1)}`,
        )
        .join(" ");
    const runsPath = toPath("count");
    return {
      runsPath,
      failPath: toPath("failure"),
      areaPath: `${runsPath} L ${CHART_WIDTH} ${CHART_HEIGHT} L 0 ${CHART_HEIGHT} Z`,
    };
  }, [buckets]);

  const startLabel = buckets[0] ? formatRelative(buckets[0].timestamp) : "60 min ago";
  const midBucket = buckets[Math.floor(buckets.length / 2)];
  const midLabel = midBucket ? formatRelative(midBucket.timestamp) : "30 min ago";

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (buckets.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(ratio * (buckets.length - 1));
    setHoverIdx(Math.max(0, Math.min(buckets.length - 1, idx)));
  }

  const hovered = hoverIdx != null ? buckets[hoverIdx] : null;
  const hoverX = hoverIdx != null ? (hoverIdx / Math.max(1, buckets.length - 1)) * 100 : 0;

  return (
    <div
      role="img"
      aria-label="Throughput over the last hour with hover details"
      className="relative"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoverIdx(null)}
    >
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="block h-[150px] w-full"
        preserveAspectRatio="none"
      >
        <title>Throughput over the last hour</title>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line
            key={g}
            x1="0"
            x2={CHART_WIDTH}
            y1={CHART_HEIGHT * g}
            y2={CHART_HEIGHT * g}
            stroke="var(--border)"
            strokeWidth="1"
            strokeDasharray="2 5"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path
          d={runsPath}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={failPath}
          fill="none"
          stroke="var(--danger)"
          strokeWidth="1.6"
          strokeOpacity="0.85"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {hovered ? (
        <>
          <div
            className="pointer-events-none absolute inset-y-0 w-px bg-[var(--border-strong)]"
            style={{ left: `${hoverX}%` }}
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -top-1.5 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--surface-3)] px-2.5 py-1.5 text-[11px] text-[var(--fg)] shadow-md"
            style={{ left: `${hoverX}%` }}
          >
            <div className="text-[var(--fg-subtle)]">{formatRelative(hovered.timestamp)}</div>
            <div className="font-mono tabular-nums">
              {formatCount(hovered.count)} runs ·{" "}
              <span className="text-danger">{formatCount(hovered.failure)} failed</span>
            </div>
          </div>
        </>
      ) : null}
      <div className="mt-1.5 flex justify-between font-mono text-[0.66rem] uppercase tracking-[0.06em] text-[var(--fg-subtle)]">
        <span>{startLabel}</span>
        <span>{midLabel}</span>
        <span>now</span>
      </div>
    </div>
  );
}
