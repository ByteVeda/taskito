import { createFileRoute } from "@tanstack/react-router";
import * as v from "valibot";
import { PageHeader } from "@/components/layout";
import { Pagination } from "@/components/ui";
import {
  useWorkflowsList,
  type WorkflowsListQuery,
  WorkflowsListTable,
  workflowsListQuery,
} from "@/features/workflows";

const stateSchema = v.optional(
  v.picklist([
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
  ]),
);

const searchSchema = v.object({
  state: stateSchema,
  definition_name: v.optional(v.string()),
  limit: v.optional(v.number(), 50),
  offset: v.optional(v.number(), 0),
});

export const Route = createFileRoute("/workflows/")({
  validateSearch: (search): WorkflowsListQuery => v.parse(searchSchema, search),
  loaderDeps: ({ search }) => ({ search }),
  loader: ({ context: { queryClient }, deps: { search } }) =>
    queryClient.ensureQueryData(workflowsListQuery(search)),
  component: WorkflowsListPage,
});

function WorkflowsListPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data, isLoading, error, refetch } = useWorkflowsList(search);

  const setPage = (offset: number) => {
    navigate({ search: (prev) => ({ ...prev, offset }), replace: true });
  };
  const pageSize = search.limit ?? 50;
  const hasMore = data ? data.runs.length >= pageSize : false;

  return (
    <>
      <PageHeader
        title="Workflows"
        description="DAG-based orchestration runs and their compensation state."
      />
      <WorkflowsListTable
        runs={data?.runs}
        loading={isLoading}
        error={error}
        onRetry={() => refetch()}
      />
      <Pagination
        page={Math.floor((search.offset ?? 0) / pageSize)}
        hasMore={hasMore}
        onChange={(p) => setPage(p * pageSize)}
      />
    </>
  );
}
