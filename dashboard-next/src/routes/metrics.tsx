import { createFileRoute } from "@tanstack/react-router";
import { BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/layout";
import { EmptyState } from "@/components/ui/empty-state";

export const Route = createFileRoute("/metrics")({
  component: MetricsPage,
});

function MetricsPage() {
  return (
    <>
      <PageHeader title="Metrics" description="Success, latency, and throughput by task." />
      <EmptyState icon={BarChart3} title="Metrics view coming online" />
    </>
  );
}
