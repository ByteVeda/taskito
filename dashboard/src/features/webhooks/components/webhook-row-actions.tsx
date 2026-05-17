import { Link } from "@tanstack/react-router";
import {
  Eye,
  History,
  MoreHorizontal,
  Power,
  PowerOff,
  RotateCcw,
  Send,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui";
import { DestructiveConfirmDialog } from "@/components/ui/destructive-confirm-dialog";
import { useDeleteWebhook, useRotateSecret, useTestWebhook, useUpdateWebhook } from "../hooks";
import type { Webhook } from "../types";
import { SecretReveal } from "./secret-reveal";

interface Props {
  webhook: Webhook;
}

export function WebhookRowActions({ webhook }: Props) {
  const update = useUpdateWebhook();
  const remove = useDeleteWebhook();
  const rotate = useRotateSecret();
  const test = useTestWebhook();

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  function onToggleEnabled() {
    update.mutate({
      id: webhook.id,
      input: { enabled: !webhook.enabled },
    });
  }

  function onRotate() {
    rotate.mutate(webhook.id, {
      onSuccess: (result) => {
        setRevealedSecret(result.secret);
      },
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Webhook actions">
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem asChild>
            <Link
              to="/webhooks/$id/deliveries"
              params={{ id: webhook.id }}
              className="flex w-full cursor-default items-center gap-2"
            >
              <History aria-hidden /> View deliveries
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => test.mutate(webhook.id)}
            disabled={test.isPending || !webhook.enabled}
          >
            <Send aria-hidden /> Send test
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onToggleEnabled} disabled={update.isPending}>
            {webhook.enabled ? (
              <>
                <PowerOff aria-hidden /> Disable
              </>
            ) : (
              <>
                <Power aria-hidden /> Enable
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setConfirmRotate(true)}>
            <RotateCcw aria-hidden /> Rotate secret
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => setConfirmDelete(true)}
            className="text-danger focus:text-danger"
          >
            <Trash2 aria-hidden /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DestructiveConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this webhook?"
        description={`Deliveries to ${webhook.url} will stop immediately.`}
        confirmLabel="Delete"
        confirmPhrase="delete"
        pending={remove.isPending}
        onConfirm={async () => {
          await remove.mutateAsync(webhook.id);
        }}
      />

      <ConfirmDialog
        open={confirmRotate}
        onOpenChange={setConfirmRotate}
        title="Rotate signing secret?"
        description="The previous secret stops working immediately. Update your receiver before continuing — taskito will sign the next delivery with the new value."
        confirmLabel="Rotate"
        onConfirm={() => {
          setConfirmRotate(false);
          onRotate();
        }}
      />

      <Dialog
        open={revealedSecret !== null}
        onOpenChange={(open) => !open && setRevealedSecret(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New signing secret</DialogTitle>
            <DialogDescription>Configure your receiver with this value.</DialogDescription>
          </DialogHeader>
          {revealedSecret ? <SecretReveal secret={revealedSecret} /> : null}
          <Button onClick={() => setRevealedSecret(null)}>
            <Eye aria-hidden /> Done
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
