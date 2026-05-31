import { createFileRoute } from "@tanstack/react-router";
import { ListTree, Search, Settings2, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorState, Input, Skeleton, StatCard } from "@/components/ui";
import { type TaskEntry, TaskListTable, useTasks } from "@/features/tasks";

export const Route = createFileRoute("/tasks")({
  component: TasksPage,
});

function TasksPage() {
  const { data, isLoading, error } = useTasks();
  const [query, setQuery] = useState("");

  const tasks = useMemo<TaskEntry[]>(() => data ?? [], [data]);

  const overrides = tasks.filter((t) => t.override != null).length;
  const rateLimited = tasks.filter((t) => t.effective.rate_limit != null).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tasks;
    return tasks.filter(
      (t) => t.name.toLowerCase().includes(q) || t.queue.toLowerCase().includes(q),
    );
  }, [tasks, query]);

  return (
    <>
      <PageHeader
        eyebrow="Configuration"
        title="Tasks"
        description="Every registered task handler, its defaults, and any operator overrides. Changes apply on the next worker restart; pausing takes effect immediately."
        actions={
          <div className="relative w-60">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-[15px] -translate-y-1/2 text-[var(--fg-subtle)]"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tasks…"
              className="pl-8"
            />
          </div>
        }
      />
      <div className="flex flex-col gap-[var(--page-gap)]">
        {error ? (
          <ErrorState
            title="Failed to load tasks"
            description={error instanceof Error ? error.message : String(error)}
          />
        ) : isLoading ? (
          <Skeleton className="h-48" />
        ) : (
          <>
            <div className="grid gap-[var(--gap)] grid-cols-[repeat(auto-fit,minmax(186px,1fr))]">
              <StatCard
                label="Registered"
                tone="neutral"
                icon={<ListTree />}
                value={tasks.length}
              />
              <StatCard
                label="With overrides"
                tone="info"
                icon={<Settings2 />}
                value={overrides}
                hint="operator-tuned"
              />
              <StatCard label="Rate limited" tone="warning" icon={<Zap />} value={rateLimited} />
            </div>
            <TaskListTable tasks={filtered} />
          </>
        )}
      </div>
    </>
  );
}
