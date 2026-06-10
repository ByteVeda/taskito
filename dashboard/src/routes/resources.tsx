import { createFileRoute } from "@tanstack/react-router";
import { Activity, CheckCircle2, Server } from "lucide-react";
import { PageHeader } from "@/components/layout";
import { StatCard } from "@/components/ui";
import { ResourcesTable, resourcesQuery, useResources } from "@/features/resources";
import { formatCount } from "@/lib/number";

export const Route = createFileRoute("/resources")({
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(resourcesQuery()),
  component: ResourcesPage,
});

function ResourcesPage() {
  const resources = useResources();
  const all = resources.data ?? [];
  const healthy = all.filter((r) => r.health.toLowerCase() === "healthy").length;
  const pools = all.filter((r) => r.pool).length;

  return (
    <div className="flex flex-col gap-[var(--page-gap)]">
      <PageHeader
        eyebrow="Infrastructure"
        title="Resources"
        description="Connection pools, init timings, and the dependency graph your tasks rely on."
      />
      <div className="grid gap-[var(--gap)] grid-cols-[repeat(auto-fit,minmax(186px,1fr))]">
        <StatCard
          label="Resources"
          tone="neutral"
          icon={<Activity />}
          value={formatCount(all.length)}
        />
        <StatCard
          label="Healthy"
          tone={all.length > 0 && healthy === all.length ? "success" : "warning"}
          icon={<CheckCircle2 />}
          value={`${healthy}/${all.length}`}
        />
        <StatCard
          label="Pools"
          tone="info"
          icon={<Server />}
          value={formatCount(pools)}
          hint="with connection pooling"
        />
      </div>
      <ResourcesTable
        resources={resources.data}
        loading={resources.isLoading}
        error={resources.error}
        onRetry={() => resources.refetch()}
      />
    </div>
  );
}
