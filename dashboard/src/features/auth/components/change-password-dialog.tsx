import { AlertCircle, KeyRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/components/ui";
import { ApiError } from "@/lib/api-client";
import { useChangePassword } from "../hooks";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChangePasswordDialog({ open, onOpenChange }: Props) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const change = useChangePassword();

  function reset() {
    setCurrent("");
    setNext("");
    setConfirm("");
    change.reset();
  }

  function handleOpenChange(value: boolean) {
    if (!value) reset();
    onOpenChange(value);
  }

  const mismatch = confirm.length > 0 && next !== confirm;
  const disabled = change.isPending || !current || !next || !confirm || mismatch;

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    change.mutate(
      { oldPassword: current, newPassword: next },
      {
        onSuccess: () => {
          toast.success("Password changed");
          handleOpenChange(false);
        },
      },
    );
  }

  const error = change.error
    ? change.error instanceof ApiError
      ? change.error.message
      : "Failed to change password"
    : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4" aria-hidden />
            Change password
          </DialogTitle>
          <DialogDescription>Enter your current password and choose a new one.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5 text-sm">
            <label htmlFor="pw-current" className="font-medium">
              Current password
            </label>
            <Input
              id="pw-current"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5 text-sm">
            <label htmlFor="pw-new" className="font-medium">
              New password
            </label>
            <Input
              id="pw-new"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5 text-sm">
            <label htmlFor="pw-confirm" className="font-medium">
              Confirm new password
            </label>
            <Input
              id="pw-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
            {mismatch ? <span className="text-xs text-danger">Passwords do not match</span> : null}
          </div>
          {error ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md bg-danger-dim px-3 py-2 text-sm text-danger"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={disabled}>
              {change.isPending ? "Saving…" : "Change password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
