import { Box } from "lucide-preact";
import type { ResourceStatus } from "../api/types";
import { Badge } from "../components/ui/badge";
import { type Column, DataTable } from "../components/ui/data-table";
import { EmptyState } from "../components/ui/empty-state";
import { Loading } from "../components/ui/loading";
import { useApi } from "../hooks/use-api";
import type { RoutableProps } from "../lib/routes";

const RESOURCE_COLUMNS: Column<ResourceStatus>[] = [
  { header: "Name", accessor: (r) => <span class="font-medium">{r.name}</span> },
  { header: "Scope", accessor: (r) => <Badge status={r.scope} /> },
  { header: "Health", accessor: (r) => <Badge status={r.health} /> },
  {
    header: "Init (ms)",
    accessor: (r) => <span class="tabular-nums text-muted">{r.init_duration_ms.toFixed(1)}ms</span>,
  },
  {
    header: "Recreations",
    accessor: (r) => (
      <span class={`tabular-nums ${r.recreations > 0 ? "text-warning" : "text-muted"}`}>
        {r.recreations}
      </span>
    ),
  },
  {
    header: "Dependencies",
    accessor: (r) =>
      r.depends_on.length ? (
        <span class="text-xs">{r.depends_on.join(", ")}</span>
      ) : (
        <span class="text-muted">{"\u2014"}</span>
      ),
  },
  {
    header: "Pool",
    accessor: (r) =>
      r.pool ? (
        <span class="text-xs tabular-nums">
          <span class="text-info">{r.pool.active}</span>/{r.pool.size} active,{" "}
          <span class="text-muted">{r.pool.idle} idle</span>
        </span>
      ) : (
        <span class="text-muted">{"\u2014"}</span>
      ),
  },
];

export function Resources(_props: RoutableProps) {
  const { data: resources, loading } = useApi<ResourceStatus[]>("/api/resources");

  if (loading && !resources) return <Loading />;

  return (
    <div>
      <div class="flex items-center gap-3 mb-6">
        <div class="p-2 rounded-lg dark:bg-surface-3 bg-slate-100">
          <Box class="w-5 h-5 text-accent" strokeWidth={1.8} />
        </div>
        <div>
          <h1 class="text-lg font-semibold dark:text-white text-slate-900">Resources</h1>
          <p class="text-xs text-muted">Worker dependency injection runtime</p>
        </div>
      </div>

      {!resources?.length ? (
        <EmptyState
          message="No resources registered"
          subtitle="Resources appear when workers start with DI configuration"
        />
      ) : (
        <DataTable columns={RESOURCE_COLUMNS} data={resources} />
      )}
    </div>
  );
}
