import { Webhook as WebhookIcon } from "lucide-react";
import {
  Badge,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import type { Webhook } from "../types";
import { WebhookRowActions } from "./webhook-row-actions";

interface Props {
  webhooks: Webhook[];
}

export function WebhookListTable({ webhooks }: Props) {
  if (webhooks.length === 0) {
    return (
      <EmptyState
        icon={WebhookIcon}
        title="No webhooks configured"
        description="Create a webhook to notify external services when jobs change state."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>URL</TableHead>
            <TableHead>Events</TableHead>
            <TableHead>Task filter</TableHead>
            <TableHead>Retries</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {webhooks.map((wh) => (
            <TableRow key={wh.id}>
              <TableCell className="max-w-md">
                <div className="flex flex-col">
                  <span className="font-mono text-xs break-all">{wh.url}</span>
                  {wh.description ? (
                    <span className="text-[11px] text-[var(--fg-subtle)]">{wh.description}</span>
                  ) : null}
                </div>
              </TableCell>
              <TableCell>
                {wh.events.length === 0 ? (
                  <Badge tone="neutral">All events</Badge>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {wh.events.slice(0, 3).map((event) => (
                      <Badge key={event} tone="info" className="font-mono text-[10px]">
                        {event}
                      </Badge>
                    ))}
                    {wh.events.length > 3 ? (
                      <Badge tone="neutral" className="text-[10px]">
                        +{wh.events.length - 3} more
                      </Badge>
                    ) : null}
                  </div>
                )}
              </TableCell>
              <TableCell>
                {wh.task_filter === null ? (
                  <span className="text-xs text-[var(--fg-subtle)]">All tasks</span>
                ) : wh.task_filter.length === 0 ? (
                  <Badge tone="danger">Disabled</Badge>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {wh.task_filter.slice(0, 2).map((task) => (
                      <Badge key={task} tone="neutral" className="font-mono text-[10px]">
                        {task}
                      </Badge>
                    ))}
                    {wh.task_filter.length > 2 ? (
                      <Badge tone="neutral" className="text-[10px]">
                        +{wh.task_filter.length - 2}
                      </Badge>
                    ) : null}
                  </div>
                )}
              </TableCell>
              <TableCell className="text-xs text-[var(--fg-muted)]">
                {wh.max_retries}× / {wh.timeout_seconds}s
              </TableCell>
              <TableCell>
                {wh.enabled ? (
                  <Badge tone="success">Enabled</Badge>
                ) : (
                  <Badge tone="neutral">Disabled</Badge>
                )}
              </TableCell>
              <TableCell>
                <WebhookRowActions webhook={wh} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
