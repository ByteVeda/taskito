import { ShieldAlert } from "lucide-preact";
import { useApi } from "../hooks/use-api";
import { DataTable, type Column } from "../components/ui/data-table";
import { Badge } from "../components/ui/badge";
import { Loading } from "../components/ui/loading";
import { EmptyState } from "../components/ui/empty-state";
import { fmtTime } from "../lib/format";
import type { CircuitBreaker as CBType } from "../api/types";
import type { RoutableProps } from "../lib/routes";

const CB_COLUMNS: Column<CBType>[] = [
  { header: "Task", accessor: (b) => <span class="font-medium">{b.task_name}</span> },
  { header: "State", accessor: (b) => <Badge status={b.state} /> },
  { header: "Failures", accessor: (b) => <span class={b.failure_count > 0 ? "text-danger tabular-nums" : "tabular-nums"}>{b.failure_count}</span> },
  { header: "Threshold", accessor: (b) => <span class="tabular-nums">{b.threshold}</span> },
  { header: "Window", accessor: (b) => `${(b.window_ms / 1000).toFixed(0)}s` },
  { header: "Cooldown", accessor: (b) => `${(b.cooldown_ms / 1000).toFixed(0)}s` },
  { header: "Last Failure", accessor: (b) => <span class="text-muted">{fmtTime(b.last_failure_at)}</span> },
];

export function CircuitBreakers(_props: RoutableProps) {
  const { data: breakers, loading } = useApi<CBType[]>("/api/circuit-breakers");

  if (loading && !breakers) return <Loading />;

  return (
    <div>
      <div class="flex items-center gap-3 mb-6">
        <div class="p-2 rounded-lg dark:bg-surface-3 bg-slate-100">
          <ShieldAlert class="w-5 h-5 text-accent" strokeWidth={1.8} />
        </div>
        <div>
          <h1 class="text-lg font-semibold dark:text-white text-slate-900">Circuit Breakers</h1>
          <p class="text-xs text-muted">Automatic failure protection status</p>
        </div>
      </div>

      {!breakers?.length ? (
        <EmptyState message="No circuit breakers configured" subtitle="Circuit breakers activate when tasks fail repeatedly" />
      ) : (
        <DataTable columns={CB_COLUMNS} data={breakers} />
      )}
    </div>
  );
}
