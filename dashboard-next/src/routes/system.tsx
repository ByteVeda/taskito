import { createFileRoute } from "@tanstack/react-router";
import { Settings2 } from "lucide-react";
import { PageHeader } from "@/components/layout";
import { EmptyState } from "@/components/ui/empty-state";

export const Route = createFileRoute("/system")({
  component: SystemPage,
});

function SystemPage() {
  return (
    <>
      <PageHeader title="System" description="Proxy stats and interception metrics." />
      <EmptyState icon={Settings2} title="System view coming online" />
    </>
  );
}
