import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui";
import type { TimeseriesBucket } from "@/lib/api-types";
import { formatCount } from "@/lib/number";

interface ThroughputSparklineProps {
  buckets: TimeseriesBucket[] | undefined;
  loading?: boolean;
}

export function ThroughputSparkline({ buckets, loading }: ThroughputSparklineProps) {
  const points = buckets ?? [];
  const total = points.reduce((sum, b) => sum + b.count, 0);
  const peak = points.reduce((max, b) => Math.max(max, b.count), 0);

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

  return (
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
  );
}
