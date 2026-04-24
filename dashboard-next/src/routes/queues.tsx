import { createFileRoute } from "@tanstack/react-router";
import { Box } from "lucide-react";
import { PageHeader } from "@/components/layout";
import { EmptyState } from "@/components/ui/empty-state";

export const Route = createFileRoute("/queues")({
  component: QueuesPage,
});

function QueuesPage() {
  return (
    <>
      <PageHeader title="Queues" description="Inspect throughput, pause or resume traffic." />
      <EmptyState icon={Box} title="Queues view coming online" />
    </>
  );
}
