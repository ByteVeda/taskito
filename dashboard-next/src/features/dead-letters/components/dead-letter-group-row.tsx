import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { DeadLetterGroup } from "../utils";
import { DeadLetterRow } from "./dead-letter-row";

interface DeadLetterGroupRowProps {
  group: DeadLetterGroup;
}

export function DeadLetterGroupRow({ group }: DeadLetterGroupRowProps) {
  const [open, setOpen] = useState(false);
  const count = group.entries.length;
  return (
    <div className="rounded-lg bg-[var(--surface)] ring-1 ring-inset ring-[var(--border)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[var(--surface-2)]/40"
      >
        {open ? (
          <ChevronDown className="mt-1 size-4 shrink-0 text-[var(--fg-subtle)]" aria-hidden />
        ) : (
          <ChevronRight className="mt-1 size-4 shrink-0 text-[var(--fg-subtle)]" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone="danger">
              {count} {count === 1 ? "failure" : "failures"}
            </Badge>
            <span className="truncate text-[var(--fg)]">{group.sampleTask}</span>
            {group.queues.map((q) => (
              <Badge key={q} tone="neutral">
                {q}
              </Badge>
            ))}
          </div>
          <div className="mt-1 line-clamp-2 font-mono text-[11px] text-danger">{group.error}</div>
        </div>
      </button>
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
