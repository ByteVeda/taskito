import { createFileRoute } from "@tanstack/react-router";
import { ScrollText } from "lucide-react";
import { PageHeader } from "@/components/layout";
import { EmptyState } from "@/components/ui/empty-state";

export const Route = createFileRoute("/logs")({
  component: LogsPage,
});

function LogsPage() {
  return (
    <>
      <PageHeader title="Logs" description="Filtered task log stream." />
      <EmptyState icon={ScrollText} title="Logs view coming online" />
    </>
  );
}
