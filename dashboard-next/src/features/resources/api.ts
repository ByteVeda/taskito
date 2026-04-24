import { api } from "@/lib/api-client";
import type { ResourceStatus } from "@/lib/api-types";

export function fetchResources(signal?: AbortSignal): Promise<ResourceStatus[]> {
  return api.get<ResourceStatus[]>("/api/resources", { signal });
}
