import { api } from "@/lib/api-client";
import type { CircuitBreaker } from "@/lib/api-types";

export function fetchCircuitBreakers(signal?: AbortSignal): Promise<CircuitBreaker[]> {
  return api.get<CircuitBreaker[]>("/api/circuit-breakers", { signal });
}
