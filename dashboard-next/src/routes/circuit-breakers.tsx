import { createFileRoute } from "@tanstack/react-router";
import { CircuitBoard } from "lucide-react";
import { PageHeader } from "@/components/layout";
import { EmptyState } from "@/components/ui/empty-state";

export const Route = createFileRoute("/circuit-breakers")({
  component: CircuitBreakersPage,
});

function CircuitBreakersPage() {
  return (
    <>
      <PageHeader
        title="Circuit breakers"
        description="State, thresholds, and cooldowns by task."
      />
      <EmptyState icon={CircuitBoard} title="Circuit breakers view coming online" />
    </>
  );
}
