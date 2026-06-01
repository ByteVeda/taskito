import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Webhook as WebhookIcon, Zap } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorState, Skeleton, StatCard } from "@/components/ui";
import {
  CreateWebhookDialog,
  useEventTypes,
  useWebhooks,
  WebhookListTable,
} from "@/features/webhooks";

export const Route = createFileRoute("/webhooks")({
  component: WebhooksPage,
});

function WebhooksPage() {
  const { data, isLoading, error } = useWebhooks();
  const { data: eventTypes } = useEventTypes();

  const webhooks = data ?? [];
  const activeCount = webhooks.filter((wh) => wh.enabled).length;
  const eventTypeCount = eventTypes?.length ?? 0;

  return (
    <div className="flex flex-col gap-[var(--page-gap)]">
      <PageHeader
        eyebrow="Configuration"
        title="Webhooks"
        description="Push job, worker, and workflow events to your own endpoints — configure URLs, filters, and signing secrets without redeploying."
        actions={<CreateWebhookDialog />}
      />

      <div className="grid gap-[var(--gap)] grid-cols-[repeat(auto-fit,minmax(186px,1fr))]">
        <StatCard label="Endpoints" tone="neutral" icon={<WebhookIcon />} value={webhooks.length} />
        <StatCard label="Active" tone="success" icon={<CheckCircle2 />} value={activeCount} />
        <StatCard
          label="Event types"
          tone="info"
          icon={<Zap />}
          value={eventTypeCount}
          hint="available to subscribe"
        />
      </div>

      {isLoading ? (
        <Skeleton className="h-48" />
      ) : error ? (
        <ErrorState
          title="Failed to load webhooks"
          description={error instanceof Error ? error.message : String(error)}
        />
      ) : (
        <WebhookListTable webhooks={webhooks} />
      )}
    </div>
  );
}
