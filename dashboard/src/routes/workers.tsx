import { createFileRoute } from "@tanstack/react-router";
import { Activity, AlertCircle, Server } from "lucide-react";
import { PageHeader } from "@/components/layout";
import { StatCard } from "@/components/ui";
import { useWorkers, WorkersTable, workersQuery } from "@/features/workers";
import { formatCount } from "@/lib/number";

const STALE_AFTER_MS = 30_000;

export const Route = createFileRoute("/workers")({
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(workersQuery()),
  component: WorkersPage,
});

function WorkersPage() {
  const workers = useWorkers();
  const all = workers.data ?? [];
  const count = workers.data?.length;
  const now = Date.now();
  const stale = all.filter((w) => now - w.last_heartbeat > STALE_AFTER_MS).length;
  const healthy = all.length - stale;

  return (
    <>
      <PageHeader
        title="Workers"
        description={
          count != null
            ? `${formatCount(count)} registered worker${count === 1 ? "" : "s"}`
            : "Active workers, heartbeats, and assignments."
        }
      />
      <div className="mb-4 grid gap-3 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
        <StatCard
          label="Registered"
          tone="neutral"
          icon={<Server className="size-4" />}
          value={formatCount(all.length)}
        />
        <StatCard
          label="Healthy"
          tone="success"
          icon={<Activity className="size-4" />}
          value={formatCount(healthy)}
        />
        <StatCard
          label="Stale"
          tone="warning"
          icon={<AlertCircle className="size-4" />}
          value={formatCount(stale)}
        />
      </div>
      <WorkersTable
        workers={workers.data}
        loading={workers.isLoading}
        error={workers.error}
        onRetry={() => workers.refetch()}
      />
    </>
  );
}
