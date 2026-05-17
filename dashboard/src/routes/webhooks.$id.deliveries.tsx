import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import {
  Button,
  ErrorState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@/components/ui";
import type { DeliveryStatus } from "@/features/webhooks";
import { DeliveryListTable, useDeliveries, useWebhooks } from "@/features/webhooks";

export const Route = createFileRoute("/webhooks/$id/deliveries")({
  component: DeliveriesPage,
});

const STATUSES: { label: string; value: DeliveryStatus | "all" }[] = [
  { label: "All statuses", value: "all" },
  { label: "Delivered", value: "delivered" },
  { label: "Failed", value: "failed" },
  { label: "Dead", value: "dead" },
];

function DeliveriesPage() {
  const { id } = Route.useParams();
  const [status, setStatus] = useState<DeliveryStatus | "all">("all");

  const webhooks = useWebhooks();
  const webhook = webhooks.data?.find((w) => w.id === id);

  const { data, isLoading, error, refetch } = useDeliveries(id, {
    status: status === "all" ? undefined : status,
    limit: 100,
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumbs={[{ label: "Webhooks", to: "/webhooks" }, { label: "Deliveries" }]}
        title={webhook ? webhook.description || webhook.url : "Webhook deliveries"}
        description={
          webhook ? `Recent delivery attempts to ${webhook.url}` : "Recent delivery attempts."
        }
        actions={
          <div className="flex items-center gap-2">
            <Select value={status} onValueChange={(v) => setStatus(v as DeliveryStatus | "all")}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="secondary" onClick={() => refetch()}>
              Refresh
            </Button>
            <Link to="/webhooks">
              <Button variant="ghost">
                <ArrowLeft aria-hidden /> Back
              </Button>
            </Link>
          </div>
        }
      />
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : error ? (
        <ErrorState
          title="Failed to load deliveries"
          description={error instanceof Error ? error.message : String(error)}
        />
      ) : (
        <DeliveryListTable subscriptionId={id} deliveries={data?.items ?? []} />
      )}
    </div>
  );
}
