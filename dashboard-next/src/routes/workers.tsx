import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout";
import { useWorkers, WorkersTable } from "@/features/workers";
import { formatCount } from "@/lib/number";

export const Route = createFileRoute("/workers")({
  component: WorkersPage,
});

function WorkersPage() {
  const workers = useWorkers();
  const count = workers.data?.length;

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
      <WorkersTable
        workers={workers.data}
        loading={workers.isLoading}
        error={workers.error}
        onRetry={() => workers.refetch()}
      />
    </>
  );
}
