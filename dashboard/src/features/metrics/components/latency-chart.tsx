import { useMemo, useState } from "react";
import {
  Brush,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui";
import type { TimeseriesBucket } from "@/lib/api-types";
import { formatAxisTime } from "../utils";

interface LatencyChartProps {
  buckets: TimeseriesBucket[] | undefined;
  loading: boolean;
}

interface Row {
  t: number;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
}

type SeriesKey = "p50_ms" | "p95_ms" | "p99_ms" | "avg_ms";

interface SeriesDef {
  key: SeriesKey;
  name: string;
  stroke: string;
  dash?: string;
  width: number;
}

const SERIES: SeriesDef[] = [
  { key: "p50_ms", name: "p50", stroke: "var(--color-info)", width: 1.4 },
  { key: "p95_ms", name: "p95", stroke: "var(--color-warning)", dash: "4 3", width: 1.4 },
  { key: "p99_ms", name: "p99", stroke: "var(--color-danger)", dash: "2 3", width: 1.4 },
  { key: "avg_ms", name: "avg", stroke: "var(--color-accent)", width: 1.8 },
];

export function LatencyChart({ buckets, loading }: LatencyChartProps) {
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());

  const data = useMemo<Row[]>(
    () =>
      (buckets ?? []).map((b) => ({
        t: b.timestamp,
        avg_ms: b.avg_ms,
        p50_ms: b.p50_ms,
        p95_ms: b.p95_ms,
        p99_ms: b.p99_ms,
      })),
    [buckets],
  );

  function toggle(key: SeriesKey) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Latency percentiles</CardTitle>
      </CardHeader>
      <CardContent>
        {loading && data.length === 0 ? (
          <Skeleton className="h-52 w-full" />
        ) : data.length === 0 ? (
          <div className="grid h-52 place-items-center text-xs text-[var(--fg-subtle)]">
            No data in the selected window
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                stroke="var(--fg-subtle)"
                tickFormatter={formatAxisTime}
                tick={{ fontSize: 11 }}
              />
              <YAxis
                stroke="var(--fg-subtle)"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => `${v}ms`}
                width={54}
              />
              <Tooltip content={<LatencyTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: 11, cursor: "pointer" }}
                iconType="circle"
                onClick={(payload) => {
                  if (payload?.dataKey) toggle(payload.dataKey as SeriesKey);
                }}
              />
              {SERIES.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.name}
                  stroke={s.stroke}
                  strokeWidth={s.width}
                  strokeDasharray={s.dash}
                  dot={false}
                  activeDot={{ r: 3 }}
                  hide={hidden.has(s.key)}
                  isAnimationActive={false}
                />
              ))}
              <Brush
                dataKey="t"
                height={20}
                stroke="var(--border-strong)"
                fill="var(--surface-2)"
                tickFormatter={formatAxisTime}
                travellerWidth={8}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

interface LatencyTooltipPayload {
  name?: string;
  value?: number;
  color?: string;
  dataKey?: string;
}

function LatencyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: LatencyTooltipPayload[];
  label?: unknown;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const ts = typeof label === "number" ? label : Number(label);
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 text-xs shadow-lg">
      <div className="mb-1 text-[var(--fg-muted)]">{new Date(ts).toLocaleTimeString()}</div>
      {payload.map((entry) => (
        <div key={entry.name ?? "series"} className="flex items-center gap-2">
          <span aria-hidden className="size-2 rounded-full" style={{ background: entry.color }} />
          <span className="text-[var(--fg-muted)]">{entry.name}</span>
          <span className="ml-auto tabular-nums text-[var(--fg)]">
            {(entry.value ?? 0).toFixed(1)} ms
          </span>
        </div>
      ))}
    </div>
  );
}
