import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/cn";

export const Route = createFileRoute("/jobs/$id")({
  component: JobDetailPage,
});

function JobDetailPage() {
  const { id } = Route.useParams();
  return (
    <>
      <PageHeader
        eyebrow="Job"
        title={id}
        actions={
          <Link to="/jobs" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            <ArrowLeft aria-hidden /> All jobs
          </Link>
        }
      />
      <EmptyState
        title="Job detail coming online"
        description="Logs, errors, replay history, and DAG will land in a later phase."
      />
    </>
  );
}
