import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout";
import { EmptyState } from "@/components/ui/empty-state";

export const Route = createFileRoute("/jobs/$id")({
  component: JobDetailPage,
});

function JobDetailPage() {
  const { id } = Route.useParams();
  return (
    <>
      <PageHeader title={id} breadcrumbs={[{ label: "Jobs", to: "/jobs" }, { label: id }]} />
      <EmptyState
        title="Job detail coming online"
        description="Logs, errors, replay history, and DAG will land in a later phase."
      />
    </>
  );
}
