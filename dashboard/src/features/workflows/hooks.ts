import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import { useRefreshInterval } from "@/providers";
import {
  fetchWorkflowChildren,
  fetchWorkflowDag,
  fetchWorkflowRun,
  fetchWorkflowRuns,
} from "./api";
import type { WorkflowsListQuery } from "./types";
import { isTerminalState } from "./types";

const KEY = {
  all: ["workflows"] as const,
  list: (q: WorkflowsListQuery) => ["workflows", "list", q] as const,
  detail: (id: string) => ["workflows", "detail", id] as const,
  dag: (id: string) => ["workflows", "detail", id, "dag"] as const,
  children: (id: string) => ["workflows", "detail", id, "children"] as const,
};

export function workflowsListQuery(query: WorkflowsListQuery) {
  return queryOptions({
    queryKey: KEY.list(query),
    queryFn: ({ signal }) => fetchWorkflowRuns(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function workflowDetailQuery(runId: string) {
  return queryOptions({
    queryKey: KEY.detail(runId),
    queryFn: ({ signal }) => fetchWorkflowRun(runId, signal),
  });
}

export function workflowDagQuery(runId: string) {
  return queryOptions({
    queryKey: KEY.dag(runId),
    queryFn: ({ signal }) => fetchWorkflowDag(runId, signal),
    staleTime: Infinity,
  });
}

export function workflowChildrenQuery(runId: string) {
  return queryOptions({
    queryKey: KEY.children(runId),
    queryFn: ({ signal }) => fetchWorkflowChildren(runId, signal),
  });
}

export function useWorkflowsList(query: WorkflowsListQuery) {
  const { intervalMs } = useRefreshInterval();
  return useQuery({
    ...workflowsListQuery(query),
    refetchInterval: intervalMs,
  });
}

export function useWorkflowDetail(runId: string) {
  const { intervalMs } = useRefreshInterval();
  return useQuery({
    ...workflowDetailQuery(runId),
    refetchInterval: (q) => (isTerminalState(q.state.data?.run.state) ? false : intervalMs),
  });
}

export function useWorkflowDag(runId: string) {
  return useQuery(workflowDagQuery(runId));
}

export function useWorkflowChildren(runId: string) {
  return useQuery(workflowChildrenQuery(runId));
}
