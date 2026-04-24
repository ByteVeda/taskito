import { createFileRoute } from "@tanstack/react-router";
import { ListTree } from "lucide-react";
import { PageHeader } from "@/components/layout";
import { EmptyState } from "@/components/ui/empty-state";

export const Route = createFileRoute("/jobs/")({
  component: JobsPage,
});

function JobsPage() {
  return (
    <>
      <PageHeader title="Jobs" description="Browse, filter, and act on task executions." />
      <EmptyState
        icon={ListTree}
        title="Jobs view coming online"
        description="This screen is being rebuilt — data will land in a later phase."
      />
    </>
  );
}
