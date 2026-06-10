import { api } from "@/lib/api-client";
import type { WorkflowNode, WorkflowRun, WorkflowState } from "@/lib/api-types";

export interface WorkflowRunsQuery {
  page: number;
  pageSize: number;
  state?: WorkflowState;
  definitionName?: string;
}

interface WorkflowRunsResponse {
  runs: WorkflowRun[];
  limit: number;
  offset: number;
}

interface WorkflowRunDetailResponse {
  run: WorkflowRun;
  nodes: WorkflowNode[];
}

interface WorkflowDagResponse {
  dag: string;
}

interface WorkflowChildrenResponse {
  children: WorkflowRun[];
}

export function fetchWorkflowRuns(
  query: WorkflowRunsQuery,
  signal?: AbortSignal,
): Promise<WorkflowRunsResponse> {
  const params: Record<string, string | number> = {
    limit: query.pageSize,
    offset: query.page * query.pageSize,
  };
  if (query.state) params.state = query.state;
  if (query.definitionName) params.definition_name = query.definitionName;
  return api.get<WorkflowRunsResponse>("/api/workflows/runs", { signal, params });
}

export function fetchWorkflowRun(
  id: string,
  signal?: AbortSignal,
): Promise<WorkflowRunDetailResponse> {
  return api.get<WorkflowRunDetailResponse>(`/api/workflows/runs/${encodeURIComponent(id)}`, {
    signal,
  });
}

export function fetchWorkflowDag(id: string, signal?: AbortSignal): Promise<WorkflowDagResponse> {
  return api.get<WorkflowDagResponse>(`/api/workflows/runs/${encodeURIComponent(id)}/dag`, {
    signal,
  });
}

export function fetchWorkflowChildren(
  id: string,
  signal?: AbortSignal,
): Promise<WorkflowChildrenResponse> {
  return api.get<WorkflowChildrenResponse>(
    `/api/workflows/runs/${encodeURIComponent(id)}/children`,
    { signal },
  );
}
