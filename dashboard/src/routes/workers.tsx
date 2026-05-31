import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Server, Skull } from "lucide-react";
import { PageHeader } from "@/components/layout";
import { StatCard } from "@/components/ui";
import { isWorkerStale, useWorkers, WorkersTable, workersQuery } from "@/features/workers";
import { formatCount } from "@/lib/number";

export const Route = createFileRoute("/workers")({
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(workersQuery()),
  component: WorkersPage,
});

function WorkersPage() {
  const workers = useWorkers();
  const all = workers.data ?? [];
  // Compute against the wall clock at render so workers "age out" between
  // refetches: the query re-renders on the user interval, refreshing these.
  const now = Date.now();
  const stale = all.filter((w) => isWorkerStale(w, now)).length;
  const online = all.length - stale;

  return (
    <div className="flex flex-col gap-[var(--page-gap)]">
      <PageHeader
        eyebrow="Infrastructure"
        title="Workers"
        description="Every worker process, what it's pulling, and when it last checked in."
      />
      <div className="grid gap-[var(--gap)] grid-cols-[repeat(auto-fit,minmax(186px,1fr))]">
        <StatCard
          label="Workers"
          tone="neutral"
          icon={<Server />}
          value={formatCount(all.length)}
        />
        <StatCard
          label="Online"
          tone="success"
          icon={<CheckCircle2 />}
          value={formatCount(online)}
        />
        <StatCard
          label="Stale"
          tone="danger"
          icon={<Skull />}
          value={formatCount(stale)}
          hint="no recent heartbeat"
        />
      </div>
      <WorkersTable
        workers={workers.data}
        loading={workers.isLoading}
        error={workers.error}
        onRetry={() => workers.refetch()}
      />
    </div>
  );
}
