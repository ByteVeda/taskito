import { Link } from "@tanstack/react-router";
import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DeadLetter } from "@/lib/api-types";
import { formatRelative } from "@/lib/time";
import { useRetryDeadLetter } from "../hooks";

interface DeadLetterRowProps {
  item: DeadLetter;
}

export function DeadLetterRow({ item }: DeadLetterRowProps) {
  const retry = useRetryDeadLetter();
  return (
    <div className="flex items-start gap-4 rounded-lg bg-[var(--surface)] p-4 ring-1 ring-inset ring-[var(--border)]">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Link
            to="/jobs/$id"
            params={{ id: item.original_job_id }}
            className="font-mono text-accent hover:underline"
          >
            {item.original_job_id.slice(0, 10)}…
          </Link>
          <span className="text-[var(--fg-muted)]">·</span>
          <span className="text-[var(--fg-muted)]">{item.task_name}</span>
          <Badge tone="neutral">{item.queue}</Badge>
          {item.retry_count > 0 ? (
            <Badge tone="warning">
              {item.retry_count} {item.retry_count === 1 ? "retry" : "retries"}
            </Badge>
          ) : null}
          <span className="ml-auto tabular-nums text-[var(--fg-subtle)]">
            {formatRelative(item.failed_at * 1000)}
          </span>
        </div>
        {item.error ? (
          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-danger-dim/30 p-2 font-mono text-[11px] text-danger">
            {item.error}
          </pre>
        ) : null}
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => retry.mutate(item.id)}
        disabled={retry.isPending}
      >
        <RotateCcw aria-hidden /> Retry
      </Button>
    </div>
  );
}
