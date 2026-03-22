import { Cog } from "lucide-preact";
import type { InterceptionStats, ProxyStats } from "../api";
import { type Column, DataTable, EmptyState, ErrorState, Loading } from "../components/ui";
import { useApi } from "../hooks";
import type { RoutableProps } from "../lib";

interface ProxyRow {
  handler: string;
  reconstructions: number;
  avg_ms: number;
  errors: number;
}

interface InterceptionRow {
  strategy: string;
  count: number;
  avg_ms: number;
}

const PROXY_COLUMNS: Column<ProxyRow>[] = [
  { header: "Handler", accessor: (r) => <span class="font-medium">{r.handler}</span> },
  {
    header: "Reconstructions",
    accessor: (r) => <span class="tabular-nums">{r.reconstructions}</span>,
  },
  {
    header: "Avg (ms)",
    accessor: (r) => <span class="tabular-nums text-muted">{r.avg_ms.toFixed(1)}ms</span>,
  },
  {
    header: "Errors",
    accessor: (r) => (
      <span class={`tabular-nums ${r.errors > 0 ? "text-danger font-medium" : "text-muted"}`}>
        {r.errors}
      </span>
    ),
  },
];

const INTERCEPTION_COLUMNS: Column<InterceptionRow>[] = [
  {
    header: "Strategy",
    accessor: (r) => <span class="font-medium uppercase text-xs tracking-wide">{r.strategy}</span>,
  },
  { header: "Count", accessor: (r) => <span class="tabular-nums">{r.count}</span> },
  {
    header: "Avg (ms)",
    accessor: (r) => <span class="tabular-nums text-muted">{r.avg_ms.toFixed(1)}ms</span>,
  },
];

export function System(_props: RoutableProps) {
  const {
    data: proxyStats,
    loading: proxyLoading,
    error: proxyError,
    refetch: refetchProxy,
  } = useApi<ProxyStats>("/api/proxy-stats");
  const {
    data: interceptionStats,
    loading: interceptLoading,
    error: interceptError,
    refetch: refetchIntercept,
  } = useApi<InterceptionStats>("/api/interception-stats");

  const proxyRows: ProxyRow[] = proxyStats
    ? Object.entries(proxyStats).map(([handler, s]) => ({ handler, ...s }))
    : [];

  const interceptRows: InterceptionRow[] = interceptionStats
    ? Object.entries(interceptionStats).map(([strategy, s]) => ({ strategy, ...s }))
    : [];

  return (
    <div>
      <div class="flex items-center gap-3 mb-8">
        <div class="p-2 rounded-lg dark:bg-surface-3 bg-slate-100">
          <Cog class="w-5 h-5 text-accent" strokeWidth={1.8} />
        </div>
        <div>
          <h1 class="text-lg font-semibold dark:text-white text-slate-900">System Internals</h1>
          <p class="text-xs text-muted">Proxy reconstruction and interception metrics</p>
        </div>
      </div>

      <div class="mb-8">
        <h2 class="text-sm font-semibold dark:text-gray-200 text-slate-700 mb-3">
          Proxy Reconstruction
        </h2>
        {proxyError && !proxyStats ? (
          <ErrorState message={proxyError} onRetry={refetchProxy} />
        ) : proxyLoading && !proxyStats ? (
          <Loading />
        ) : !proxyRows.length ? (
          <EmptyState
            message="No proxy stats available"
            subtitle="Stats appear when proxy handlers are used"
          />
        ) : (
          <DataTable columns={PROXY_COLUMNS} data={proxyRows} />
        )}
      </div>

      <div>
        <h2 class="text-sm font-semibold dark:text-gray-200 text-slate-700 mb-3">Interception</h2>
        {interceptError && !interceptionStats ? (
          <ErrorState message={interceptError} onRetry={refetchIntercept} />
        ) : interceptLoading && !interceptionStats ? (
          <Loading />
        ) : !interceptRows.length ? (
          <EmptyState
            message="No interception stats available"
            subtitle="Stats appear when argument interception is enabled"
          />
        ) : (
          <DataTable columns={INTERCEPTION_COLUMNS} data={interceptRows} />
        )}
      </div>
    </div>
  );
}
