import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout";
import { ResourcesTable, resourcesQuery, useResources } from "@/features/resources";

export const Route = createFileRoute("/resources")({
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(resourcesQuery()),
  component: ResourcesPage,
});

function ResourcesPage() {
  const resources = useResources();

  return (
    <>
      <PageHeader
        title="Resources"
        description="Worker-side DI: health, pools, and dependency graph."
      />
      <ResourcesTable
        resources={resources.data}
        loading={resources.isLoading}
        error={resources.error}
        onRetry={() => resources.refetch()}
      />
    </>
  );
}
