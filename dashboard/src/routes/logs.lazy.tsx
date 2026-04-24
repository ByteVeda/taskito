import { createLazyFileRoute } from "@tanstack/react-router";
import LogsPage from "@/features/logs";

export const Route = createLazyFileRoute("/logs")({
  component: LogsPage,
});
