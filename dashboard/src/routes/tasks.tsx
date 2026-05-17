import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout/page-header";
import { ErrorState, Skeleton } from "@/components/ui";
import { TaskListTable, useTasks } from "@/features/tasks";

export const Route = createFileRoute("/tasks")({
  component: TasksPage,
});

function TasksPage() {
  const { data, isLoading, error } = useTasks();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Tasks"
        description="Every registered task with its decorator defaults and any runtime overrides. Changes apply on the next worker restart; pausing takes effect immediately."
      />
      {isLoading ? (
        <Skeleton className="h-48" />
      ) : error ? (
        <ErrorState
          title="Failed to load tasks"
          description={error instanceof Error ? error.message : String(error)}
        />
      ) : (
        <TaskListTable tasks={data ?? []} />
      )}
    </div>
  );
}
