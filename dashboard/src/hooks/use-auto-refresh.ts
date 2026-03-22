import { signal } from "@preact/signals";

export const refreshInterval = signal<number>(5000);

export function setRefreshInterval(ms: number): void {
  refreshInterval.value = ms;
}
