import { api } from "@/lib/api-client";
import type { DeadLetter } from "@/lib/api-types";

export interface DeadLettersPage {
  items: DeadLetter[];
}

export function fetchDeadLetters(
  page: number,
  pageSize: number,
  signal?: AbortSignal,
): Promise<DeadLetter[]> {
  return api.get<DeadLetter[]>("/api/dead-letters", {
    signal,
    params: { limit: pageSize, offset: page * pageSize },
  });
}

export function retryDeadLetter(id: string): Promise<{ new_job_id: string }> {
  return api.post<{ new_job_id: string }>(`/api/dead-letters/${encodeURIComponent(id)}/retry`);
}

export function purgeDeadLetters(): Promise<{ purged: number }> {
  return api.post<{ purged: number }>("/api/dead-letters/purge");
}

export function deleteDeadLetter(id: string): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/api/dead-letters/${encodeURIComponent(id)}`);
}
