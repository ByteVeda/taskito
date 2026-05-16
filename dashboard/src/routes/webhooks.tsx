import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorState, Skeleton } from "@/components/ui";
import { CreateWebhookDialog, useWebhooks, WebhookListTable } from "@/features/webhooks";

export const Route = createFileRoute("/webhooks")({
  component: WebhooksPage,
});

function WebhooksPage() {
  const { data, isLoading, error } = useWebhooks();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Webhooks"
        description="HTTP endpoints that receive job lifecycle events. Configure URLs, event filters, and signing secrets without redeploying."
        actions={<CreateWebhookDialog />}
      />
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : error ? (
        <ErrorState
          title="Failed to load webhooks"
          description={error instanceof Error ? error.message : String(error)}
        />
      ) : (
        <WebhookListTable webhooks={data ?? []} />
      )}
    </div>
  );
}
