import { api } from "@/lib/api-client";
import type { QueueEntry, QueueOverridePatch, TaskEntry, TaskOverridePatch } from "./types";

export function listTasks(signal?: AbortSignal): Promise<TaskEntry[]> {
  return api.get<TaskEntry[]>("/api/tasks", { signal });
}

export function listQueues(signal?: AbortSignal): Promise<QueueEntry[]> {
  return api.get<QueueEntry[]>("/api/queues", { signal });
}

export function putTaskOverride(name: string, patch: TaskOverridePatch): Promise<unknown> {
  return api.put(`/api/tasks/${encodeURIComponent(name)}/override`, patch);
}

export function clearTaskOverride(name: string): Promise<{ cleared: boolean }> {
  return api.delete<{ cleared: boolean }>(`/api/tasks/${encodeURIComponent(name)}/override`);
}

export function putQueueOverride(name: string, patch: QueueOverridePatch): Promise<unknown> {
  return api.put(`/api/queues/${encodeURIComponent(name)}/override`, patch);
}

export function clearQueueOverride(name: string): Promise<{ cleared: boolean }> {
  return api.delete<{ cleared: boolean }>(`/api/queues/${encodeURIComponent(name)}/override`);
}
