import { Send, Shield, Webhook as WebhookIcon } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  LiveDot,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui";
import { formatRelative } from "@/lib/time";
import { useTestWebhook, useUpdateWebhook } from "../hooks";
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
    <div className="grid gap-[var(--gap)] [grid-template-columns:repeat(auto-fill,minmax(290px,1fr))]">
      {webhooks.map((wh) => (
        <WebhookCard key={wh.id} webhook={wh} />
      ))}
    </div>
  );
}

function WebhookCard({ webhook }: { webhook: Webhook }) {
  const update = useUpdateWebhook();
  const test = useTestWebhook();

  const events = webhook.events;
  const shownEvents = events.slice(0, 4);
  const extraEvents = events.length - shownEvents.length;

  return (
    <div
      className={`flex flex-col rounded-[var(--card-radius)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card-shadow)] transition-shadow hover:shadow-[var(--card-hover-shadow)] ${
        webhook.enabled ? "" : "opacity-60"
      }`}
    >
      <div className="flex flex-col gap-3 p-[var(--pad)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold text-[0.92rem] leading-snug">
              {webhook.description || "Untitled webhook"}
            </div>
            <div className="truncate font-mono text-[0.74rem] text-[var(--fg-subtle)]">
              {webhook.url}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Switch
              checked={webhook.enabled}
              disabled={update.isPending}
              aria-label={webhook.enabled ? "Disable webhook" : "Enable webhook"}
              onCheckedChange={(enabled) => update.mutate({ id: webhook.id, input: { enabled } })}
            />
            <WebhookRowActions webhook={webhook} />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {events.length === 0 ? (
            <Badge tone="accent">all events</Badge>
          ) : (
            <>
              {shownEvents.map((event) => (
                <Badge key={event} tone="neutral" className="font-mono text-[10px]">
                  {event}
                </Badge>
              ))}
              {extraEvents > 0 ? (
                <Badge tone="neutral" className="text-[10px]">
                  +{extraEvents}
                </Badge>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-[var(--pad)] py-3">
        <span className="inline-flex items-center gap-2 text-[0.74rem] text-[var(--fg-muted)]">
          <LiveDot tone={webhook.enabled ? "success" : "danger"} pulse={false} />
          created {formatRelative(webhook.created_at)}
        </span>
        <div className="flex items-center gap-3">
          {webhook.has_secret ? (
            <span className="inline-flex items-center gap-1 text-[0.72rem] text-[var(--fg-subtle)]">
              <Shield className="size-3.5" aria-hidden />
              signed
            </span>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={webhook.enabled ? undefined : 0}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => test.mutate(webhook.id)}
                  disabled={test.isPending || !webhook.enabled}
                >
                  <Send className="size-3.5" aria-hidden />
                  Test
                </Button>
              </span>
            </TooltipTrigger>
            {!webhook.enabled ? <TooltipContent>Enable the webhook first</TooltipContent> : null}
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
