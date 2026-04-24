import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import type { JobStatus } from "@/lib/api-types";
import { cn } from "@/lib/cn";
import { JOB_STATUS_LABEL } from "@/lib/status";
import type { JobFilters } from "../types";
import { countActiveFilters } from "../utils";

const STATUS_OPTIONS: JobStatus[] = [
  "pending",
  "running",
  "complete",
  "failed",
  "dead",
  "cancelled",
];

interface JobFiltersBarProps {
  filters: JobFilters;
  onChange: (filters: JobFilters) => void;
  className?: string;
}

/**
 * Debounced filter bar for the jobs list.
 *
 * Text inputs (queue/task/metadata/error) keep local state and push through
 * after a 300ms idle window; the Status select and date range are applied
 * immediately since they're deliberate clicks. This keeps the API from
 * being hammered while the user is still typing.
 */
export function JobFiltersBar({ filters, onChange, className }: JobFiltersBarProps) {
  const [local, setLocal] = useState(() => ({
    queue: filters.queue ?? "",
    task: filters.task ?? "",
    metadata: filters.metadata ?? "",
    error: filters.error ?? "",
  }));

  // Reflect external changes (e.g., URL navigation) back into local state.
  useEffect(() => {
    setLocal({
      queue: filters.queue ?? "",
      task: filters.task ?? "",
      metadata: filters.metadata ?? "",
      error: filters.error ?? "",
    });
  }, [filters.queue, filters.task, filters.metadata, filters.error]);

  const debouncedQueue = useDebouncedValue(local.queue, 300);
  const debouncedTask = useDebouncedValue(local.task, 300);
  const debouncedMetadata = useDebouncedValue(local.metadata, 300);
  const debouncedError = useDebouncedValue(local.error, 300);

  useEffect(() => {
    const next: JobFilters = {
      ...filters,
      queue: debouncedQueue || undefined,
      task: debouncedTask || undefined,
      metadata: debouncedMetadata || undefined,
      error: debouncedError || undefined,
    };
    if (
      next.queue !== filters.queue ||
      next.task !== filters.task ||
      next.metadata !== filters.metadata ||
      next.error !== filters.error
    ) {
      onChange(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: propagate only debounced values
  }, [debouncedQueue, debouncedTask, debouncedMetadata, debouncedError]);

  const activeCount = countActiveFilters(filters);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-lg bg-[var(--surface)] p-3 ring-1 ring-inset ring-[var(--border)]",
        className,
      )}
    >
      <div className="grid gap-2 md:grid-cols-5">
        <Select
          value={filters.status ?? "all"}
          onValueChange={(v) =>
            onChange({ ...filters, status: v === "all" ? undefined : (v as JobStatus) })
          }
        >
          <SelectTrigger aria-label="Status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {JOB_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={local.queue}
          onChange={(e) => setLocal((p) => ({ ...p, queue: e.target.value }))}
          placeholder="Queue name"
        />
        <Input
          value={local.task}
          onChange={(e) => setLocal((p) => ({ ...p, task: e.target.value }))}
          placeholder="Task name"
        />
        <Input
          value={local.metadata}
          onChange={(e) => setLocal((p) => ({ ...p, metadata: e.target.value }))}
          placeholder="Metadata contains…"
        />
        <Input
          value={local.error}
          onChange={(e) => setLocal((p) => ({ ...p, error: e.target.value }))}
          placeholder="Error contains…"
        />
      </div>

      <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
        <DateInput
          label="Created after"
          value={filters.createdAfter}
          onChange={(ts) => onChange({ ...filters, createdAfter: ts })}
        />
        <DateInput
          label="Created before"
          value={filters.createdBefore}
          onChange={(ts) => onChange({ ...filters, createdBefore: ts })}
        />
        <Button
          variant="ghost"
          size="sm"
          disabled={activeCount === 0}
          onClick={() => onChange({})}
          className="self-end"
        >
          <X aria-hidden /> Clear {activeCount > 0 ? `(${activeCount})` : null}
        </Button>
      </div>
    </div>
  );
}

function DateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | undefined;
  onChange: (ts: number | undefined) => void;
}) {
  // Backend stores unix seconds; <input type="datetime-local"> uses "YYYY-MM-DDTHH:mm".
  const localValue = value ? unixToLocalDatetime(value) : "";
  return (
    <label className="flex flex-col gap-1 text-xs text-[var(--fg-subtle)]">
      <span>{label}</span>
      <input
        type="datetime-local"
        value={localValue}
        onChange={(e) => {
          const raw = e.target.value;
          if (!raw) {
            onChange(undefined);
            return;
          }
          const ms = new Date(raw).getTime();
          if (!Number.isFinite(ms)) return;
          onChange(Math.floor(ms / 1000));
        }}
        className="h-9 rounded-md bg-[var(--surface)] px-3 text-sm ring-1 ring-inset ring-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
      />
    </label>
  );
}

function unixToLocalDatetime(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
