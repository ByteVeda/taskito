import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import { formatRelative } from "@/lib/time";
import { useRetryDeadLetter } from "../hooks";
import type { DeadLetterGroup } from "../utils";
import { DeadLetterRow } from "./dead-letter-row";

interface DeadLetterGroupRowProps {
  group: DeadLetterGroup;
}

export function DeadLetterGroupRow({ group }: DeadLetterGroupRowProps) {
  const [open, setOpen] = useState(false);
  const retry = useRetryDeadLetter();
  const count = group.entries.length;
  const reasonCount = group.reasons.length;

  async function retryAll() {
    // Sequential fan-out so we don't stampede the worker and so a per-item
    // failure doesn't abort the others. Each retry invalidation settles the
    // list query; TanStack Query coalesces the refetches.
    for (const entry of group.entries) {
      try {
        await retry.mutateAsync(entry.id);
      } catch {
        /* toast surfaces the error; keep going */
      }
    }
  }

  return (
    <div className="rounded-lg bg-[var(--surface)] ring-1 ring-inset ring-[var(--border)]">
      <div className="flex items-start gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Collapse group" : "Expand group"}
          className="mt-1 shrink-0 rounded p-0.5 text-[var(--fg-subtle)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--fg)]"
        >
          {open ? (
            <ChevronDown className="size-4" aria-hidden />
          ) : (
            <ChevronRight className="size-4" aria-hidden />
          )}
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone="danger">
              {count} {count === 1 ? "failure" : "failures"}
            </Badge>
            <span className="truncate font-medium text-[var(--fg)]">{group.taskName}</span>
            <span className="rounded bg-[var(--surface-3)] px-1.5 py-0.5 font-mono text-[10px] text-danger">
              {group.exceptionClass}
            </span>
            {group.queues.map((q) => (
              <Badge key={q} tone="neutral">
                {q}
              </Badge>
            ))}
            <span className="ml-auto tabular-nums text-[var(--fg-subtle)]">
              last {formatRelative(group.latestFailedAt)}
            </span>
          </div>
          <div className="mt-1 line-clamp-2 font-mono text-[11px] text-danger">
            {group.reasons[0]}
            {reasonCount > 1 ? (
              <span className="ml-2 text-[var(--fg-subtle)]">
                +{reasonCount - 1} more reason{reasonCount - 1 === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
        </button>
        <Button
          variant="secondary"
          size="sm"
          onClick={retryAll}
          disabled={retry.isPending}
          className="shrink-0"
        >
          <RotateCcw aria-hidden /> Retry all
        </Button>
      </div>
      {open ? (
        <ul className="flex flex-col gap-2 border-t border-[var(--border)] bg-[var(--bg-subtle)] p-3">
          {group.entries.map((entry) => (
            <li key={entry.id}>
              <DeadLetterRow item={entry} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
