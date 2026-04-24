import { createFileRoute } from "@tanstack/react-router";
import { Server } from "lucide-react";
import { PageHeader } from "@/components/layout";
import { EmptyState } from "@/components/ui/empty-state";

export const Route = createFileRoute("/workers")({
  component: WorkersPage,
});

function WorkersPage() {
  return (
    <>
      <PageHeader title="Workers" description="Active workers, heartbeats, and assignments." />
      <EmptyState icon={Server} title="Workers view coming online" />
    </>
  );
}
