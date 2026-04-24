import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { Job } from "@/lib/api-types";
import { useRefreshInterval } from "@/providers";
import {
  cancelJob,
  fetchJob,
  fetchJobDag,
  fetchJobErrors,
  fetchJobLogs,
  fetchJobs,
  fetchReplayHistory,
  replayJob,
} from "./api";
import type { JobListQuery } from "./types";
import { isTerminalStatus } from "./utils";

const KEY = {
  all: ["jobs"] as const,
  list: (q: JobListQuery) => ["jobs", "list", q] as const,
  detail: (id: string) => ["jobs", "detail", id] as const,
  logs: (id: string) => ["jobs", "detail", id, "logs"] as const,
  errors: (id: string) => ["jobs", "detail", id, "errors"] as const,
  replays: (id: string) => ["jobs", "detail", id, "replays"] as const,
  dag: (id: string) => ["jobs", "detail", id, "dag"] as const,
};

export function jobsListQuery(query: JobListQuery) {
  return queryOptions({
    queryKey: KEY.list(query),
    queryFn: ({ signal }) => fetchJobs(query, signal),
    placeholderData: keepPreviousData,
  });
}

export function jobDetailQuery(id: string) {
  return queryOptions({
    queryKey: KEY.detail(id),
    queryFn: ({ signal }) => fetchJob(id, signal),
  });
}

export function jobLogsQuery(id: string) {
  return queryOptions({
    queryKey: KEY.logs(id),
    queryFn: ({ signal }) => fetchJobLogs(id, signal),
  });
}

export function jobErrorsQuery(id: string) {
  return queryOptions({
    queryKey: KEY.errors(id),
    queryFn: ({ signal }) => fetchJobErrors(id, signal),
  });
}

export function jobReplayHistoryQuery(id: string) {
  return queryOptions({
    queryKey: KEY.replays(id),
    queryFn: ({ signal }) => fetchReplayHistory(id, signal),
  });
}

export function jobDagQuery(id: string) {
  return queryOptions({
    queryKey: KEY.dag(id),
    queryFn: ({ signal }) => fetchJobDag(id, signal),
  });
}

/**
 * Paginated job list. Uses `keepPreviousData` to avoid flashing empty state
 * between pages, and polls at the dashboard-wide refresh cadence.
 */
export function useJobs(query: JobListQuery) {
  const { intervalMs } = useRefreshInterval();
  return useQuery({ ...jobsListQuery(query), refetchInterval: intervalMs });
}

/**
 * Single job detail. Polling stops once the job reaches a terminal state so
 * we don't keep hammering the API for data that won't change again.
 */
export function useJob(id: string, enabled = true) {
  const { intervalMs } = useRefreshInterval();
  return useQuery({
    ...jobDetailQuery(id),
    enabled,
    refetchInterval: (query) => {
      const data = query.state.data as Job | undefined;
      if (data && isTerminalStatus(data.status)) return false;
      return intervalMs;
    },
  });
}

export function useJobLogs(id: string, enabled = true) {
  const { intervalMs } = useRefreshInterval();
  return useQuery({ ...jobLogsQuery(id), enabled, refetchInterval: intervalMs });
}

export function useJobErrors(id: string, enabled = true) {
  const { intervalMs } = useRefreshInterval();
  return useQuery({ ...jobErrorsQuery(id), enabled, refetchInterval: intervalMs });
}

export function useReplayHistory(id: string, enabled = true) {
  return useQuery({ ...jobReplayHistoryQuery(id), enabled });
}

export function useJobDag(id: string, enabled = true) {
  return useQuery({ ...jobDagQuery(id), enabled });
}

interface MutationContext {
  prev: Job | undefined;
}

/**
 * Cancel a pending/running job.
 *
 * Optimistically flips local status to "cancelled" so the UI feels instant;
 * if the request fails we roll back and surface a toast. On settle we
 * invalidate every cached list so pagination/stats refresh.
 */
export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelJob(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: KEY.detail(id) });
      const prev = qc.getQueryData<Job>(KEY.detail(id));
      if (prev) {
        qc.setQueryData<Job>(KEY.detail(id), { ...prev, status: "cancelled" });
      }
      return { prev } satisfies MutationContext;
    },
    onError: (error, id, ctx) => {
      if (ctx?.prev) qc.setQueryData(KEY.detail(id), ctx.prev);
      toast.error("Couldn't cancel job", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
    onSuccess: (result) => {
      if (result.cancelled) {
        toast.success("Job cancelled");
      } else {
        toast.info("Job wasn't in a cancellable state");
      }
    },
    onSettled: (_data, _err, id) => {
      qc.invalidateQueries({ queryKey: KEY.detail(id) });
      qc.invalidateQueries({ queryKey: KEY.all });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

/**
 * Replay a terminal job. Returns the new job ID to the caller so the route
 * can navigate to it.
 */
export function useReplayJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => replayJob(id),
    onError: (error) => {
      toast.error("Couldn't replay job", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
    onSuccess: (result) => {
      toast.success("Job re-enqueued", {
        description: `New job: ${result.replay_job_id.slice(0, 8)}…`,
      });
    },
    onSettled: (_data, _err, id) => {
      qc.invalidateQueries({ queryKey: KEY.detail(id) });
      qc.invalidateQueries({ queryKey: KEY.replays(id) });
      qc.invalidateQueries({ queryKey: KEY.all });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
