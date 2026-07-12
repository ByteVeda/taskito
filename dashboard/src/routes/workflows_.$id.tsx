import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader } from "@/components/layout";
import {
  Badge,
  ErrorState,
  type KvItem,
  KvList,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import {
  useWorkflowChildren,
  useWorkflowDag,
  useWorkflowRun,
  WorkflowDagTab,
  WorkflowNodesTable,
  WorkflowRunsTable,
  workflowRunQuery,
} from "@/features/workflows";
import { WORKFLOW_STATE_LABEL, WORKFLOW_STATE_TONE } from "@/lib/status";
import { parseTaskError, taskErrorSummary } from "@/lib/task-error";
import { formatAbsolute, formatDuration } from "@/lib/time";

export const Route = createFileRoute("/workflows_/$id")({
  loader: ({ context: { queryClient }, params: { id } }) =>
    queryClient.ensureQueryData(workflowRunQuery(id)),
  component: WorkflowDetailPage,
});

function WorkflowDetailPage() {
  const { id } = Route.useParams();
  const [tab, setTab] = useState("overview");
  const run = useWorkflowRun(id);
  const dag = useWorkflowDag(id, tab === "dag");
  const children = useWorkflowChildren(id, tab === "children");

  if (run.isLoading && !run.data) {
    return (
      <>
        <PageHeader
          title="Loading workflow…"
          breadcrumbs={[{ label: "Workflows", to: "/workflows" }, { label: id }]}
        />
        <Skeleton className="h-96 w-full" />
      </>
    );
  }

  if (run.error || !run.data) {
    return (
      <>
        <PageHeader
          title="Workflow run"
          breadcrumbs={[{ label: "Workflows", to: "/workflows" }, { label: id }]}
        />
        <ErrorState
          title="Couldn't load workflow run"
          description={run.error?.message ?? "This run may have been purged."}
          onRetry={() => run.refetch()}
        />
      </>
    );
  }

  const data = run.data.run;
  const nodes = run.data.nodes;
  const tone = WORKFLOW_STATE_TONE[data.state];

  const duration =
    data.started_at != null && data.completed_at != null
      ? formatDuration(data.completed_at - data.started_at)
      : null;

  const kvItems: KvItem[] = [
    { label: "Run ID", value: data.id, mono: true },
    { label: "Definition", value: data.definition_id, mono: true },
    { label: "State", value: WORKFLOW_STATE_LABEL[data.state] },
    { label: "Created", value: formatAbsolute(data.created_at) },
    { label: "Started", value: data.started_at ? formatAbsolute(data.started_at) : "—" },
    { label: "Completed", value: data.completed_at ? formatAbsolute(data.completed_at) : "—" },
    { label: "Duration", value: duration ?? "—", mono: true },
    { label: "Nodes", value: String(nodes.length), mono: true },
  ];

  if (data.parent_run_id) {
    kvItems.push({ label: "Parent run", value: data.parent_run_id, mono: true });
  }
  if (data.error) {
    // Structured task errors collapse to their headline; the KV list is
    // one-line-per-item and can't host a traceback block.
    const structured = parseTaskError(data.error);
    kvItems.push({ label: "Error", value: structured ? taskErrorSummary(structured) : data.error });
  }

  return (
    <>
      <PageHeader
        title={data.definition_id}
        description={
          <span className="inline-flex items-center gap-2 font-mono text-xs text-[var(--fg-subtle)]">
            {data.id}
          </span>
        }
        breadcrumbs={[{ label: "Workflows", to: "/workflows" }, { label: data.id.slice(0, 8) }]}
        actions={<Badge tone={tone}>{WORKFLOW_STATE_LABEL[data.state]}</Badge>}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="nodes">Nodes</TabsTrigger>
          <TabsTrigger value="dag">DAG</TabsTrigger>
          <TabsTrigger value="children">Children</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <KvList items={kvItems} />
        </TabsContent>
        <TabsContent value="nodes">
          <WorkflowNodesTable nodes={nodes} />
        </TabsContent>
        <TabsContent value="dag">
          <WorkflowDagTab
            dagJson={dag.data?.dag}
            loading={dag.isLoading}
            error={dag.error}
            onRetry={() => dag.refetch()}
          />
        </TabsContent>
        <TabsContent value="children">
          <WorkflowRunsTable
            runs={children.data?.children}
            loading={children.isLoading}
            error={children.error}
            onRetry={() => children.refetch()}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
