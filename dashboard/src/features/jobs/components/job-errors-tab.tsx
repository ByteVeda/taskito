import { AlertOctagon } from "lucide-react";
import { EmptyState, ErrorState, Skeleton, TaskErrorBlock } from "@/components/ui";
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
              {formatAbsolute(err.failed_at)}
            </span>
          </div>
          <TaskErrorBlock error={err.error} className="max-h-60 bg-danger-dim/30 p-3" />
        </div>
      ))}
    </div>
  );
}
