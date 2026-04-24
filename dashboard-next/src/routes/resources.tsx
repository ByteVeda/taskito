import { createFileRoute } from "@tanstack/react-router";
import { Activity } from "lucide-react";
import { PageHeader } from "@/components/layout";
import { EmptyState } from "@/components/ui/empty-state";

export const Route = createFileRoute("/resources")({
  component: ResourcesPage,
});

function ResourcesPage() {
  return (
    <>
      <PageHeader title="Resources" description="Worker-side DI: health, pools, scopes." />
      <EmptyState icon={Activity} title="Resources view coming online" />
    </>
  );
}
