import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { Skeleton } from "@/components/ui";
import { useAuthStatus, useWhoami } from "../hooks";

/**
 * Wraps the authenticated portion of the dashboard.
 *
 * - When setup is required, redirects to ``/login`` (which shows the setup
 *   form).
 * - When the user isn't signed in, redirects to ``/login``.
 * - While loading, renders a centered skeleton so the page never flashes
 *   raw content.
 *
 * Once a session resolves, children render normally.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const status = useAuthStatus();
  const whoami = useWhoami();

  const setupRequired = status.data?.setup_required === true;
  const authenticated = !!whoami.data?.user;
  const loading = status.isLoading || whoami.isLoading;

  useEffect(() => {
    if (loading) return;
    if (setupRequired || !authenticated) {
      void navigate({ to: "/login" });
    }
  }, [loading, setupRequired, authenticated, navigate]);

  if (loading || setupRequired || !authenticated) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex flex-col items-center gap-3">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
