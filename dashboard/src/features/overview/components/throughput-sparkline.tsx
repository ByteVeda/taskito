import { useState } from "react";
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

export function ThroughputSparkline({
  buckets,
  loading,
  error,
  onRetry,
}: ThroughputSparklineProps) {
  const points = buckets ?? [];
  const total = points.reduce((sum, b) => sum + b.count, 0);
  const peak = points.reduce((max, b) => Math.max(max, b.count), 0);

  if (error) {
    return (
      <ErrorState title="Couldn't load throughput" description={error.message} onRetry={onRetry} />
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-baseline justify-between gap-4 pb-2">
        <CardTitle>Throughput — last hour</CardTitle>
        {loading ? (
          <Skeleton className="h-4 w-24" />
        ) : (
          <span className="text-xs text-[var(--fg-subtle)]">
            {formatCount(total)} runs · peak {formatCount(peak)}/min
          </span>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-20 w-full" />
        ) : points.length === 0 ? (
          <div className="grid h-20 place-items-center text-xs text-[var(--fg-subtle)]">
            No activity in this window
          </div>
        ) : (
          <Sparkline buckets={points} />
        )}
      </CardContent>
    </Card>
  );
}

function Sparkline({ buckets }: { buckets: TimeseriesBucket[] }) {
  const width = 800;
  const height = 80;
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const step = buckets.length > 1 ? width / (buckets.length - 1) : 0;
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const areaPath = buckets
    .map((b, i) => {
      const x = i * step;
      const y = height - (b.count / maxCount) * height;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .concat([`L ${width} ${height}`, `L 0 ${height}`, "Z"])
    .join(" ");

  const linePath = buckets
    .map((b, i) => {
      const x = i * step;
      const y = height - (b.count / maxCount) * height;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const startLabel = buckets[0] ? formatRelative(buckets[0].timestamp) : "";
  const endLabel = "now";
  const midBucket = buckets[Math.floor(buckets.length / 2)];
  const midLabel = midBucket ? formatRelative(midBucket.timestamp) : "";

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
      aria-label="Throughput chart with hover details"
      className="relative"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoverIdx(null)}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Throughput over the last hour"
        className="h-20 w-full"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="sparkline-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#sparkline-fill)" />
        <path
          d={linePath}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="1.5"
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
            className="pointer-events-none absolute -top-1 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-[var(--surface-3)] px-2 py-1 text-[11px] text-[var(--fg)] shadow-sm ring-1 ring-inset ring-[var(--border)]"
            style={{ left: `${hoverX}%` }}
          >
            <div className="text-[var(--fg-subtle)]">{formatRelative(hovered.timestamp)}</div>
            <div className="font-mono tabular-nums">
              {formatCount(hovered.count)} runs · {formatCount(hovered.failure)} failed
            </div>
          </div>
        </>
      ) : null}
      <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-[var(--fg-subtle)]">
        <span>{startLabel}</span>
        <span>{midLabel}</span>
        <span>{endLabel}</span>
      </div>
    </div>
  );
}
