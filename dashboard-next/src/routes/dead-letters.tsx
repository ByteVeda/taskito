import { createFileRoute } from "@tanstack/react-router";
import { Skull } from "lucide-react";
import { PageHeader } from "@/components/layout";
import { EmptyState } from "@/components/ui/empty-state";

export const Route = createFileRoute("/dead-letters")({
  component: DeadLettersPage,
});

function DeadLettersPage() {
  return (
    <>
      <PageHeader title="Dead letters" description="Failures that exhausted retries." />
      <EmptyState icon={Skull} title="Dead letters view coming online" />
    </>
  );
}
