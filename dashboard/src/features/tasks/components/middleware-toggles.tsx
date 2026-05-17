import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Power } from "lucide-react";
import { toast } from "sonner";
import { ErrorState, Skeleton } from "@/components/ui";
import { api } from "@/lib/api-client";

interface TaskMiddlewareEntry {
  name: string;
  class_path: string;
  disabled: boolean;
  effective: boolean;
}

interface TaskMiddlewareResponse {
  task: string;
  middleware: TaskMiddlewareEntry[];
}

interface Props {
  taskName: string;
}

const queryKey = (task: string) => ["tasks", task, "middleware"] as const;

export function MiddlewareToggles({ taskName }: Props) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: queryKey(taskName),
    queryFn: ({ signal }) =>
      api.get<TaskMiddlewareResponse>(`/api/tasks/${encodeURIComponent(taskName)}/middleware`, {
        signal,
      }),
  });

  const mutation = useMutation({
    mutationFn: ({ mwName, enabled }: { mwName: string; enabled: boolean }) =>
      api.put(
        `/api/tasks/${encodeURIComponent(taskName)}/middleware/${encodeURIComponent(mwName)}`,
        { enabled },
      ),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: queryKey(taskName) });
    },
    onError: () => toast.error("Failed to update middleware"),
  });

  if (query.isLoading) {
    return <Skeleton className="h-32" />;
  }
  if (query.error) {
    return (
      <ErrorState
        title="Failed to load middleware"
        description={query.error instanceof Error ? query.error.message : String(query.error)}
      />
    );
  }
  const entries = query.data?.middleware ?? [];
  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-4 py-6 text-center text-sm text-[var(--fg-muted)]">
        No middleware registered for this task.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry) => {
        const enabled = !entry.disabled;
        return (
          <li
            key={entry.name}
            className="flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--surface-1)] px-3 py-2"
          >
            <div className="min-w-0">
              <div className="font-mono text-xs text-[var(--fg)] truncate">{entry.name}</div>
              <div className="text-[11px] text-[var(--fg-subtle)] truncate">{entry.class_path}</div>
            </div>
            <button
              type="button"
              onClick={() => mutation.mutate({ mwName: entry.name, enabled: !enabled })}
              disabled={mutation.isPending}
              aria-pressed={enabled}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                enabled
                  ? "bg-success-dim text-success ring-1 ring-success/30"
                  : "bg-[var(--surface-3)] text-[var(--fg-muted)] ring-1 ring-[var(--border-strong)]"
              }`}
            >
              <Power className="size-3.5" aria-hidden />
              {enabled ? "Enabled" : "Disabled"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
