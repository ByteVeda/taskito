import { AlertOctagon } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { JobError } from "@/lib/api-types";
import { formatAbsolute } from "@/lib/time";

interface JobErrorsTabProps {
  errors: JobError[] | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function JobErrorsTab({ errors, loading, error, onRetry }: JobErrorsTabProps) {
  if (error) {
    return (
      <ErrorState title="Couldn't load errors" description={error.message} onRetry={onRetry} />
    );
  }

  if (loading && !errors) {
    return <Skeleton className="h-40 w-full" />;
  }

  if (!errors || errors.length === 0) {
    return (
      <EmptyState
        icon={AlertOctagon}
        title="No errors recorded"
        description="This job completed without tripping any retry."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {errors.map((err) => (
        <div
          key={`${err.attempt}-${err.failed_at}`}
          className="rounded-lg bg-[var(--surface)] p-4 ring-1 ring-inset ring-[var(--border)]"
        >
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium text-[var(--fg)]">Attempt {err.attempt}</span>
            <span className="tabular-nums text-[var(--fg-subtle)]">
              {formatAbsolute(err.failed_at * 1000)}
            </span>
          </div>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-danger-dim/30 p-3 font-mono text-[11px] text-danger">
            {err.error}
          </pre>
        </div>
      ))}
    </div>
  );
}
