import { AlertCircle, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
} from "@/components/ui";
import { ApiError } from "@/lib/api-client";
import { useCreateWebhook } from "../hooks";
import type { Webhook } from "../types";
import { EventTypeMultiSelect } from "./event-type-multi-select";
import { SecretReveal } from "./secret-reveal";
import { TaskFilterInput } from "./task-filter-input";

export function CreateWebhookDialog() {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [taskFilter, setTaskFilter] = useState<string[] | null>(null);
  const [generateSecret, setGenerateSecret] = useState(true);
  const [createdWebhook, setCreatedWebhook] = useState<Webhook | null>(null);
  const create = useCreateWebhook();

  function reset() {
    setUrl("");
    setDescription("");
    setEvents([]);
    setTaskFilter(null);
    setGenerateSecret(true);
    setCreatedWebhook(null);
    create.reset();
  }

  function onOpenChange(next: boolean) {
    if (!next) reset();
    setOpen(next);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    create.mutate(
      {
        url,
        description: description || null,
        events,
        task_filter: taskFilter,
        generate_secret: generateSecret,
      },
      { onSuccess: (webhook) => setCreatedWebhook(webhook) },
    );
  }

  const errorMessage =
    create.error instanceof ApiError
      ? create.error.message
      : create.error
        ? "Failed to create webhook."
        : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden /> New webhook
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {createdWebhook ? (
          <SuccessView webhook={createdWebhook} onDone={() => onOpenChange(false)} />
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>New webhook</DialogTitle>
              <DialogDescription>
                Subscribe an HTTP endpoint to job lifecycle events.
              </DialogDescription>
            </DialogHeader>
            <label htmlFor="webhook-url" className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">URL</span>
              <Input
                id="webhook-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-service.example.com/hooks"
                required
              />
            </label>
            <label htmlFor="webhook-desc" className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Description</span>
              <Input
                id="webhook-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional — e.g. ops failures"
              />
            </label>
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Events</span>
              <EventTypeMultiSelect value={events} onChange={setEvents} />
              <span className="text-xs text-[var(--fg-subtle)]">
                Leave empty to subscribe to every event.
              </span>
            </div>
            <TaskFilterInput value={taskFilter} onChange={setTaskFilter} />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={generateSecret}
                onChange={(e) => setGenerateSecret(e.target.checked)}
              />
              Auto-generate a signing secret (HMAC-SHA256)
            </label>
            {errorMessage ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md bg-danger-dim px-3 py-2 text-sm text-danger"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{errorMessage}</span>
              </div>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
                disabled={create.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending || !url}>
                {create.isPending ? "Creating…" : "Create webhook"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SuccessView({ webhook, onDone }: { webhook: Webhook; onDone: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>Webhook created</DialogTitle>
        <DialogDescription>
          Deliveries will start immediately for the events you selected.
        </DialogDescription>
      </DialogHeader>
      <div className="rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm">
        <div className="text-xs text-[var(--fg-subtle)]">URL</div>
        <div className="font-mono text-xs break-all">{webhook.url}</div>
      </div>
      {webhook.secret ? <SecretReveal secret={webhook.secret} /> : null}
      <DialogFooter>
        <Button onClick={onDone}>Done</Button>
      </DialogFooter>
    </div>
  );
}
