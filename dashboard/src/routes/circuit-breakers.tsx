import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout";
import { CircuitBreakersTable, useCircuitBreakers } from "@/features/circuit-breakers";

export const Route = createFileRoute("/circuit-breakers")({
  component: CircuitBreakersPage,
});

function CircuitBreakersPage() {
  const breakers = useCircuitBreakers();

  return (
    <>
      <PageHeader
        title="Circuit breakers"
        description="State, thresholds, and cooldowns by task."
      />
      <CircuitBreakersTable
        breakers={breakers.data}
        loading={breakers.isLoading}
        error={breakers.error}
        onRetry={() => breakers.refetch()}
      />
    </>
  );
}
