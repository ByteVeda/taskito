import { api } from "@/lib/api-client";
import type { InterceptionStats, ProxyStats } from "@/lib/api-types";

export function fetchProxyStats(signal?: AbortSignal): Promise<ProxyStats> {
  return api.get<ProxyStats>("/api/proxy-stats", { signal });
}

export function fetchInterceptionStats(signal?: AbortSignal): Promise<InterceptionStats> {
  return api.get<InterceptionStats>("/api/interception-stats", { signal });
}
