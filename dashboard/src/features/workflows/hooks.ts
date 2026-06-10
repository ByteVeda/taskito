import { keepPreviousData, queryOptions, useQuery } from "@tanstack/react-query";
import type { WorkflowState } from "@/lib/api-types";
import { useRefreshInterval } from "@/providers";
import {
  fetchWorkflowChildren,
  fetchWorkflowDag,
  fetchWorkflowRun,
  fetchWorkflowRuns,
} from "./api";

const KEY = {
  all: ["workflows"] as const,
  runs: (page: number, pageSize: number, state?: WorkflowState, defName?: string) =>
    ["workflows", "runs", page, pageSize, state, defName] as const,
  run: (id: string) => ["workflows", "run", id] as const,
  dag: (id: string) => ["workflows", "dag", id] as const,
  children: (id: string) => ["workflows", "children", id] as const,
};

export function workflowRunsQuery(
  page: number,
  pageSize: number,
  state?: WorkflowState,
  definitionName?: string,
) {
  return queryOptions({
    queryKey: KEY.runs(page, pageSize, state, definitionName),
    queryFn: ({ signal }) => fetchWorkflowRuns({ page, pageSize, state, definitionName }, signal),
    placeholderData: keepPreviousData,
  });
}

export function workflowRunQuery(id: string) {
  return queryOptions({
    queryKey: KEY.run(id),
    queryFn: ({ signal }) => fetchWorkflowRun(id, signal),
  });
}

export function workflowDagQuery(id: string) {
  return queryOptions({
    queryKey: KEY.dag(id),
    queryFn: ({ signal }) => fetchWorkflowDag(id, signal),
  });
}

export function workflowChildrenQuery(id: string) {
  return queryOptions({
    queryKey: KEY.children(id),
    queryFn: ({ signal }) => fetchWorkflowChildren(id, signal),
  });
}

export function useWorkflowRuns(
  page: number,
  pageSize: number,
  state?: WorkflowState,
  definitionName?: string,
) {
  const { intervalMs } = useRefreshInterval();
  return useQuery({
    ...workflowRunsQuery(page, pageSize, state, definitionName),
    refetchInterval: intervalMs,
  });
}

export function useWorkflowRun(id: string) {
  const { intervalMs } = useRefreshInterval();
  return useQuery({ ...workflowRunQuery(id), refetchInterval: intervalMs });
}

export function useWorkflowDag(id: string, enabled: boolean) {
  return useQuery({ ...workflowDagQuery(id), enabled });
}

export function useWorkflowChildren(id: string, enabled: boolean) {
  const { intervalMs } = useRefreshInterval();
  return useQuery({ ...workflowChildrenQuery(id), refetchInterval: intervalMs, enabled });
}
