import { createLazyFileRoute } from "@tanstack/react-router";
import MetricsPage from "@/features/metrics";

export const Route = createLazyFileRoute("/metrics")({
  component: MetricsPage,
});
