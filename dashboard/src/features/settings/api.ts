import { api } from "@/lib/api-client";
import type { SettingsSnapshot } from "./types";

export function fetchSettings(signal?: AbortSignal): Promise<SettingsSnapshot> {
  return api.get<SettingsSnapshot>("/api/settings", { signal });
}

export interface SettingResponse {
  key: string;
  value: string;
}

export function setSetting(key: string, value: unknown): Promise<SettingResponse> {
  return api.put<SettingResponse>(`/api/settings/${encodeURIComponent(key)}`, { value });
}

export function deleteSetting(key: string): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/api/settings/${encodeURIComponent(key)}`);
}
