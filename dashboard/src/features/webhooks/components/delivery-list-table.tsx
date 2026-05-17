import { History, RotateCcw } from "lucide-react";
import { useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { formatRelative } from "@/lib/time";
import { useReplayDelivery } from "../hooks";
import type { DeliveryStatus, WebhookDelivery } from "../types";

interface Props {
  subscriptionId: string;
  deliveries: WebhookDelivery[];
}

function statusTone(status: DeliveryStatus): "success" | "danger" | "warning" | "neutral" {
  if (status === "delivered") return "success";
  if (status === "dead") return "danger";
  if (status === "failed") return "warning";
  return "neutral";
}

export function DeliveryListTable({ subscriptionId, deliveries }: Props) {
  const [inspecting, setInspecting] = useState<WebhookDelivery | null>(null);
  const replay = useReplayDelivery(subscriptionId);

  if (deliveries.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No deliveries yet"
        description="Once jobs start firing matching events, attempts will show up here."
      />
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Latency</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveries.map((delivery) => (
              <TableRow
                key={delivery.id}
                className="cursor-pointer"
                onClick={() => setInspecting(delivery)}
              >
                <TableCell className="text-xs text-[var(--fg-muted)]">
                  {formatRelative(delivery.created_at)}
                </TableCell>
                <TableCell className="font-mono text-xs">{delivery.event}</TableCell>
                <TableCell>
                  <Badge tone={statusTone(delivery.status)}>{delivery.status}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{delivery.response_code ?? "—"}</TableCell>
                <TableCell className="text-xs text-[var(--fg-muted)]">
                  {delivery.latency_ms !== null ? `${delivery.latency_ms} ms` : "—"}
                </TableCell>
                <TableCell className="text-xs text-[var(--fg-muted)]">
                  {delivery.attempts}
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => replay.mutate(delivery.id)}
                    disabled={replay.isPending}
                    title="Replay this delivery"
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                    <span className="ml-1 text-xs">Replay</span>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={inspecting !== null} onOpenChange={(open) => !open && setInspecting(null)}>
        <DialogContent className="sm:max-w-2xl">
          {inspecting ? (
            <>
              <DialogHeader>
                <DialogTitle>Delivery details</DialogTitle>
                <DialogDescription>
                  {inspecting.event} ·{" "}
                  <Badge tone={statusTone(inspecting.status)}>{inspecting.status}</Badge>
                </DialogDescription>
              </DialogHeader>
              <DeliveryDetail delivery={inspecting} />
              <div className="flex justify-end">
                <Button
                  onClick={() => {
                    replay.mutate(inspecting.id);
                    setInspecting(null);
                  }}
                  disabled={replay.isPending}
                >
                  <RotateCcw aria-hidden /> Replay delivery
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function DeliveryDetail({ delivery }: { delivery: WebhookDelivery }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <Row label="Attempts" value={String(delivery.attempts)} />
      <Row
        label="Response code"
        value={delivery.response_code !== null ? String(delivery.response_code) : "—"}
      />
      <Row
        label="Latency"
        value={delivery.latency_ms !== null ? `${delivery.latency_ms} ms` : "—"}
      />
      {delivery.error ? (
        <Row
          label="Error"
          value={
            <code className="block whitespace-pre-wrap break-all rounded bg-[var(--bg)] px-2 py-1 text-xs text-danger">
              {delivery.error}
            </code>
          }
        />
      ) : null}
      <div>
        <div className="text-xs font-medium text-[var(--fg-muted)] mb-1">Payload</div>
        <pre className="max-h-48 overflow-auto rounded-md bg-[var(--bg)] p-3 text-xs">
          {JSON.stringify(delivery.payload, null, 2)}
        </pre>
      </div>
      {delivery.response_body ? (
        <div>
          <div className="text-xs font-medium text-[var(--fg-muted)] mb-1">
            Response body (truncated)
          </div>
          <pre className="max-h-32 overflow-auto rounded-md bg-[var(--bg)] p-3 text-xs">
            {delivery.response_body}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3">
      <div className="w-32 shrink-0 text-xs text-[var(--fg-muted)]">{label}</div>
      <div className="flex-1 text-sm">{value}</div>
    </div>
  );
}
