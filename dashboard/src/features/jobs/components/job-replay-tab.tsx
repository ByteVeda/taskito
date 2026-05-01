import { Link } from "@tanstack/react-router";
import { RotateCcw } from "lucide-react";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui";
import type { ReplayEntry } from "@/lib/api-types";
import { formatAbsolute, formatRelative } from "@/lib/time";

interface JobReplayTabProps {
  replays: ReplayEntry[] | undefined;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function JobReplayTab({ replays, loading, error, onRetry }: JobReplayTabProps) {
  if (error) {
    return (
      <ErrorState
        title="Couldn't load replay history"
        description={error.message}
        onRetry={onRetry}
      />
    );
  }
  if (loading && !replays) return <Skeleton className="h-40 w-full" />;

  if (!replays || replays.length === 0) {
    return (
      <EmptyState
        icon={RotateCcw}
        title="Not replayed"
        description="When you replay a failed or completed job, its history appears here."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {replays.map((entry) => (
        <li
          key={entry.replay_job_id}
          className="rounded-lg bg-[var(--surface)] p-4 ring-1 ring-inset ring-[var(--border)]"
        >
          <div className="flex items-center justify-between gap-4">
            <Link
              to="/jobs/$id"
              params={{ id: entry.replay_job_id }}
              className="font-mono text-xs text-accent hover:underline"
            >
              {entry.replay_job_id}
            </Link>
            <span className="text-xs tabular-nums text-[var(--fg-subtle)]">
              {formatAbsolute(entry.replayed_at)} · {formatRelative(entry.replayed_at)}
            </span>
          </div>
          {entry.original_error ? (
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
                Original error
              </div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-danger-dim/30 p-2 font-mono text-[11px] text-danger">
                {entry.original_error}
              </pre>
            </div>
          ) : null}
          {entry.replay_error ? (
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-subtle)]">
                Replay error
              </div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-danger-dim/30 p-2 font-mono text-[11px] text-danger">
                {entry.replay_error}
              </pre>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
