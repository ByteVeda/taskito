import { api } from "@/lib/api-client";
import type { DagData, Job, JobError, ReplayEntry, TaskLog } from "@/lib/api-types";
import type { JobListQuery } from "./types";
import { toApiParams } from "./utils";

export function fetchJobs(query: JobListQuery, signal?: AbortSignal): Promise<Job[]> {
  return api.get<Job[]>("/api/jobs", { signal, params: toApiParams(query) });
}

export function fetchJob(id: string, signal?: AbortSignal): Promise<Job> {
  return api.get<Job>(`/api/jobs/${encodeURIComponent(id)}`, { signal });
}

export function fetchJobLogs(id: string, signal?: AbortSignal): Promise<TaskLog[]> {
  return api.get<TaskLog[]>(`/api/jobs/${encodeURIComponent(id)}/logs`, { signal });
}

export function fetchJobErrors(id: string, signal?: AbortSignal): Promise<JobError[]> {
  return api.get<JobError[]>(`/api/jobs/${encodeURIComponent(id)}/errors`, { signal });
}

export function fetchReplayHistory(id: string, signal?: AbortSignal): Promise<ReplayEntry[]> {
  return api.get<ReplayEntry[]>(`/api/jobs/${encodeURIComponent(id)}/replay-history`, {
    signal,
  });
}

export function fetchJobDag(id: string, signal?: AbortSignal): Promise<DagData> {
  return api.get<DagData>(`/api/jobs/${encodeURIComponent(id)}/dag`, { signal });
}

export function cancelJob(id: string): Promise<{ cancelled: boolean }> {
  return api.post<{ cancelled: boolean }>(`/api/jobs/${encodeURIComponent(id)}/cancel`);
}

export function replayJob(id: string): Promise<{ replay_job_id: string }> {
  return api.post<{ replay_job_id: string }>(`/api/jobs/${encodeURIComponent(id)}/replay`);
}
