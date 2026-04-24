import { QueryErrorResetBoundary } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import { Button } from "@/components/ui/button";

function RouteErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-danger-dim text-danger">
          <AlertTriangle className="size-5" aria-hidden />
        </div>
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="mt-2 break-words text-sm text-[var(--fg-muted)]">
          {error instanceof Error ? error.message : String(error)}
        </p>
        <Button variant="secondary" className="mt-5" onClick={resetErrorBoundary}>
          Try again
        </Button>
      </div>
    </div>
  );
}

export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary FallbackComponent={RouteErrorFallback} onReset={reset}>
          {children}
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
