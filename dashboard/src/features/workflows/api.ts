import { api } from "@/lib/api-client";
import type {
  WorkflowChildrenResponse,
  WorkflowDagResponse,
  WorkflowRunDetailResponse,
  WorkflowRunListResponse,
} from "@/lib/api-types";
import type { WorkflowsListQuery } from "./types";

export function fetchWorkflowRuns(
  query: WorkflowsListQuery,
  signal?: AbortSignal,
): Promise<WorkflowRunListResponse> {
  const params: Record<string, string | number | undefined> = {
    state: query.state,
    definition_name: query.definition_name,
    limit: query.limit,
    offset: query.offset,
  };
  return api.get<WorkflowRunListResponse>("/api/workflows/runs", { signal, params });
}

export function fetchWorkflowRun(
  runId: string,
  signal?: AbortSignal,
): Promise<WorkflowRunDetailResponse> {
  return api.get<WorkflowRunDetailResponse>(`/api/workflows/runs/${encodeURIComponent(runId)}`, {
    signal,
  });
}

export function fetchWorkflowDag(
  runId: string,
  signal?: AbortSignal,
): Promise<WorkflowDagResponse> {
  return api.get<WorkflowDagResponse>(`/api/workflows/runs/${encodeURIComponent(runId)}/dag`, {
    signal,
  });
}

export function fetchWorkflowChildren(
  runId: string,
  signal?: AbortSignal,
): Promise<WorkflowChildrenResponse> {
  return api.get<WorkflowChildrenResponse>(
    `/api/workflows/runs/${encodeURIComponent(runId)}/children`,
    { signal },
  );
}
