import { QueryErrorResetBoundary } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ErrorBoundary, type FallbackProps } from "react-error-boundary";
import { ErrorState } from "@/components/ui";

function RouteErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className="grid min-h-[50vh] place-items-center">
      <ErrorState
        title="Something went wrong"
        description={error instanceof Error ? error.message : String(error)}
        onRetry={resetErrorBoundary}
        retryLabel="Try again"
        className="max-w-md"
      />
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
