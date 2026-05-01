import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, Skeleton } from "@/components/ui";
import type { TimeseriesBucket } from "@/lib/api-types";
import { formatAxisTime } from "../utils";

interface ThroughputChartProps {
  buckets: TimeseriesBucket[] | undefined;
  loading: boolean;
}

interface Row {
  t: number;
  success: number;
  failure: number;
}

export function ThroughputChart({ buckets, loading }: ThroughputChartProps) {
  const data = useMemo<Row[]>(
    () =>
      (buckets ?? []).map((b) => ({
        t: b.timestamp * 1000,
        success: b.success,
        failure: b.failure,
      })),
    [buckets],
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Throughput</CardTitle>
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
            <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="thr-success" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--color-success)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="thr-failure" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-danger)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="var(--color-danger)" stopOpacity={0} />
                </linearGradient>
              </defs>
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
              <YAxis stroke="var(--fg-subtle)" tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
              <Area
                type="monotone"
                dataKey="success"
                stroke="var(--color-success)"
                strokeWidth={1.5}
                fill="url(#thr-success)"
                name="Success"
                stackId="1"
              />
              <Area
                type="monotone"
                dataKey="failure"
                stroke="var(--color-danger)"
                strokeWidth={1.5}
                fill="url(#thr-failure)"
                name="Failure"
                stackId="1"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

interface TooltipPayload {
  name?: string;
  value?: number;
  color?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
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
          <span className="ml-auto tabular-nums text-[var(--fg)]">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}
