import { useMemo } from "react";
import {
  CartesianGrid,
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
}

export function LatencyChart({ buckets, loading }: LatencyChartProps) {
  const data = useMemo<Row[]>(
    () => (buckets ?? []).map((b) => ({ t: b.timestamp, avg_ms: b.avg_ms })),
    [buckets],
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Average latency</CardTitle>
      </CardHeader>
      <CardContent>
        {loading && data.length === 0 ? (
          <Skeleton className="h-52 w-full" />
        ) : data.length === 0 ? (
          <div className="grid h-52 place-items-center text-xs text-[var(--fg-subtle)]">
            No data in the selected window
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
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
              <Line
                type="monotone"
                dataKey="avg_ms"
                stroke="var(--color-accent)"
                strokeWidth={1.8}
                dot={false}
                activeDot={{ r: 3 }}
                name="avg"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

interface LatencyTooltipPayload {
  value?: number;
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
  const avg = payload[0]?.value ?? 0;
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-2 text-xs shadow-lg">
      <div className="text-[var(--fg-muted)]">{new Date(ts).toLocaleTimeString()}</div>
      <div className="mt-0.5 tabular-nums text-[var(--fg)]">{avg.toFixed(1)} ms avg</div>
    </div>
  );
}
