import { signal } from "@preact/signals";

export const refreshInterval = signal<number>(5000);
export const lastRefreshAt = signal<number>(Date.now());

export function setRefreshInterval(ms: number): void {
  refreshInterval.value = ms;
}

export function markRefreshed(): void {
  lastRefreshAt.value = Date.now();
}
