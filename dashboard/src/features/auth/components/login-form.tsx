import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, LogIn } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { useLogin } from "../hooks";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: "Invalid username or password.",
  setup_required: "Dashboard setup is required before login.",
};

export function LoginForm() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useLogin();

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    login.mutate(
      { username, password },
      {
        onSuccess: () => {
          void navigate({ to: "/" });
        },
      },
    );
  }

  const error = errorMessage(login.error);
  const disabled = login.isPending || !username || !password;

  return (
    <form
      onSubmit={onSubmit}
      className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-6 shadow-sm"
    >
      <div>
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">
          Enter your dashboard credentials to continue.
        </p>
      </div>
      <label htmlFor="login-username" className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Username</span>
        <Input
          id="login-username"
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoFocus
        />
      </label>
      <label htmlFor="login-password" className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Password</span>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
        <LogIn aria-hidden /> {login.isPending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

function errorMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiError) {
    const code =
      typeof error.body === "object" && error.body && "error" in error.body
        ? String((error.body as { error: unknown }).error)
        : "";
    return ERROR_MESSAGES[code] ?? error.message ?? "Sign-in failed.";
  }
  return "Sign-in failed.";
}
