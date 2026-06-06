import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout";
import { Pagination } from "@/components/ui";
import { useWorkflowRuns, WorkflowRunsTable, workflowRunsQuery } from "@/features/workflows";
import type { WorkflowState } from "@/lib/api-types";

const PAGE_SIZE = 25;

const VALID_STATES: WorkflowState[] = [
  "pending",
  "running",
  "paused",
  "completed",
  "completed_with_failures",
  "failed",
  "cancelled",
  "compensating",
  "compensated",
  "compensation_failed",
];

interface WorkflowSearch {
  page: number;
  state?: WorkflowState;
}

function parseSearch(raw: Record<string, unknown>): WorkflowSearch {
  const pageRaw = Number(raw.page);
  const page = Number.isFinite(pageRaw) && pageRaw >= 0 ? Math.floor(pageRaw) : 0;
  const state = VALID_STATES.find((s) => s === raw.state);
  return { page, state };
}

export const Route = createFileRoute("/workflows")({
  validateSearch: parseSearch,
  loaderDeps: ({ search }) => ({ page: search.page, state: search.state }),
  loader: ({ context: { queryClient }, deps: { page, state } }) =>
    queryClient.ensureQueryData(workflowRunsQuery(page, PAGE_SIZE, state)),
  component: WorkflowsPage,
});

function WorkflowsPage() {
  const { page, state } = Route.useSearch();
  const navigate = Route.useNavigate();

  const query = useWorkflowRuns(page, PAGE_SIZE, state);
  const runs = query.data?.runs;
  const hasMore = runs ? runs.length >= PAGE_SIZE : false;

  function setPage(next: number) {
    navigate({ search: (prev) => ({ ...prev, page: next }) });
  }

  function setState(next: WorkflowState | undefined) {
    navigate({ search: { page: 0, state: next }, replace: true });
  }

  return (
    <div className="flex flex-col gap-[var(--page-gap)]">
      <PageHeader
        eyebrow="Monitoring"
        title="Workflows"
        description="Every workflow run and its current state."
        actions={<StateFilter value={state} onChange={setState} />}
      />
      <WorkflowRunsTable
        runs={runs}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => query.refetch()}
      />
      <Pagination page={page} hasMore={hasMore} onChange={setPage} />
    </div>
  );
}

function StateFilter({
  value,
  onChange,
}: {
  value: WorkflowState | undefined;
  onChange: (v: WorkflowState | undefined) => void;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange((e.target.value || undefined) as WorkflowState | undefined)}
      className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--fg)]"
      aria-label="Filter by state"
    >
      <option value="">All states</option>
      {VALID_STATES.map((s) => (
        <option key={s} value={s}>
          {s.replaceAll("_", " ")}
        </option>
      ))}
    </select>
  );
}
