import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, ShieldCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { useLogin, useSetup } from "../hooks";

export function SetupForm() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const setup = useSetup();
  const login = useLogin();

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setFormError(null);
    if (password !== confirm) {
      setFormError("Passwords don't match.");
      return;
    }
    setup.mutate(
      { username, password },
      {
        onSuccess: () => {
          // Auto-login as the brand-new admin so the user lands on the
          // dashboard without an extra hop.
          login.mutate(
            { username, password },
            {
              onSuccess: () => {
                void navigate({ to: "/" });
              },
            },
          );
        },
      },
    );
  }

  const pending = setup.isPending || login.isPending;
  const disabled = pending || !username || !password || !confirm;
  const apiError = errorMessage(setup.error ?? login.error);
  const error = formError ?? apiError;

  return (
    <form
      onSubmit={onSubmit}
      className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-6 shadow-sm"
    >
      <div>
        <h1 className="text-lg font-semibold">Create the first admin</h1>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">
          Set up the initial dashboard administrator. You'll be signed in automatically.
        </p>
      </div>
      <label htmlFor="setup-username" className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Username</span>
        <Input
          id="setup-username"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoFocus
        />
      </label>
      <label htmlFor="setup-password" className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Password</span>
        <Input
          id="setup-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
      </label>
      <label htmlFor="setup-confirm" className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Confirm password</span>
        <Input
          id="setup-confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          minLength={8}
          required
        />
      </label>
      {error ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md bg-danger-dim px-3 py-2 text-sm text-danger"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}
      <Button type="submit" disabled={disabled}>
        <ShieldCheck aria-hidden /> {pending ? "Creating…" : "Create admin"}
      </Button>
    </form>
  );
}

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiError) return error.message;
  return "Setup failed.";
}
