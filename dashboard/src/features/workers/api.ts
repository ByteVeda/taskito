import { api } from "@/lib/api-client";
import type { Worker } from "@/lib/api-types";

export function fetchWorkers(signal?: AbortSignal): Promise<Worker[]> {
  return api.get<Worker[]>("/api/workers", { signal });
}
