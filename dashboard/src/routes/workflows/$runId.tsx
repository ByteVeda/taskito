import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout";
import { ErrorState, Skeleton } from "@/components/ui";
import {
  CompensationPanel,
  RunHeaderCard,
  RunNodesTable,
  shouldShowCompensationPanel,
  useWorkflowDag,
  useWorkflowDetail,
  WorkflowDagSvg,
  workflowDagQuery,
  workflowDetailQuery,
} from "@/features/workflows";

export const Route = createFileRoute("/workflows/$runId")({
  loader: ({ context: { queryClient }, params: { runId } }) =>
    Promise.all([
      queryClient.ensureQueryData(workflowDetailQuery(runId)),
      queryClient.ensureQueryData(workflowDagQuery(runId)),
    ]),
  component: WorkflowRunDetailPage,
});

function WorkflowRunDetailPage() {
  const { runId } = Route.useParams();
  const detail = useWorkflowDetail(runId);
  const dag = useWorkflowDag(runId);

  if (detail.isLoading && !detail.data) {
    return (
      <>
        <PageHeader
          title="Loading run…"
          breadcrumbs={[{ label: "Workflows", to: "/workflows" }, { label: runId }]}
        />
        <Skeleton className="h-96 w-full" />
      </>
    );
  }

  if (detail.error || !detail.data) {
    return (
      <>
        <PageHeader
          title="Run not found"
          breadcrumbs={[{ label: "Workflows", to: "/workflows" }, { label: runId }]}
        />
        <ErrorState onRetry={() => detail.refetch()} />
      </>
    );
  }

  const { run, nodes } = detail.data;
  const showCompensation = shouldShowCompensationPanel(run.state);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Run ${runId.slice(0, 8)}…`}
        breadcrumbs={[
          { label: "Workflows", to: "/workflows" },
          { label: `${runId.slice(0, 12)}…` },
        ]}
      />

      <RunHeaderCard run={run} />

      <section>
        <h2 className="mb-3 text-sm font-medium text-[var(--fg)]">DAG</h2>
        {dag.data ? (
          <WorkflowDagSvg dagRaw={dag.data.dag} nodes={nodes} />
        ) : dag.error ? (
          <ErrorState onRetry={() => dag.refetch()} />
        ) : (
          <Skeleton className="h-72 w-full" />
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-[var(--fg)]">Nodes</h2>
        <RunNodesTable nodes={nodes} />
      </section>

      {showCompensation && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-[var(--fg)]">Compensation</h2>
          <CompensationPanel nodes={nodes} />
        </section>
      )}
    </div>
  );
}
