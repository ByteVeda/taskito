import { api } from "@/lib/api-client";
import type { QueueStatsMap } from "@/lib/api-types";

export function fetchQueueStats(signal?: AbortSignal): Promise<QueueStatsMap> {
  return api.get<QueueStatsMap>("/api/stats/queues", { signal });
}

export function fetchPausedQueues(signal?: AbortSignal): Promise<string[]> {
  return api.get<string[]>("/api/queues/paused", { signal });
}

export function pauseQueue(name: string): Promise<{ paused: string }> {
  return api.post<{ paused: string }>(`/api/queues/${encodeURIComponent(name)}/pause`);
}

export function resumeQueue(name: string): Promise<{ resumed: string }> {
  return api.post<{ resumed: string }>(`/api/queues/${encodeURIComponent(name)}/resume`);
}
