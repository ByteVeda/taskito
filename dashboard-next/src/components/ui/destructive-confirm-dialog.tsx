import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface DestructiveConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /**
   * Word the user must type to unlock the destructive button. Matched case
   * sensitively so a trained eye has to confirm intent.
   */
  confirmPhrase: string;
  confirmLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  onConfirm: () => void | Promise<void>;
}

/**
 * Confirmation dialog for irreversible destructive actions.
 *
 * Instead of a single click, requires typing a specific phrase. Meant for
 * actions like purge-all, drop-table, delete-workspace — the stakes are
 * high enough that the friction is the feature.
 */
export function DestructiveConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmPhrase,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  pending = false,
  onConfirm,
}: DestructiveConfirmDialogProps) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const ready = typed === confirmPhrase;

  async function handleConfirm() {
    if (!ready) return;
    await onConfirm();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-2">
          <label htmlFor="destructive-confirm" className="text-xs text-[var(--fg-muted)]">
            Type <span className="font-mono font-semibold text-[var(--fg)]">{confirmPhrase}</span>{" "}
            to confirm.
          </label>
          <Input
            id="destructive-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoFocus
            disabled={pending}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button variant="danger" onClick={handleConfirm} disabled={!ready || pending}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
