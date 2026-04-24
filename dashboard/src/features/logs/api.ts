import { api } from "@/lib/api-client";
import type { TaskLog } from "@/lib/api-types";

export const LOG_LEVELS = ["debug", "info", "warning", "error"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LogsQuery {
  task?: string;
  level?: LogLevel;
  sinceSeconds: number;
  limit: number;
}

export function fetchLogs(query: LogsQuery, signal?: AbortSignal): Promise<TaskLog[]> {
  const params: Record<string, string | number> = {
    since: query.sinceSeconds,
    limit: query.limit,
  };
  if (query.task) params.task = query.task;
  if (query.level) params.level = query.level;
  return api.get<TaskLog[]>("/api/logs", { signal, params });
}
