import { api } from "@/lib/api-client";
import type {
  AuthStatus,
  LoginResponse,
  ProvidersResponse,
  SetupResponse,
  WhoamiResponse,
} from "./types";

export function fetchAuthStatus(signal?: AbortSignal): Promise<AuthStatus> {
  return api.get<AuthStatus>("/api/auth/status", { signal });
}

export function fetchProviders(signal?: AbortSignal): Promise<ProvidersResponse> {
  return api.get<ProvidersResponse>("/api/auth/providers", { signal });
}

/** Browser URL the user is sent to when they click an OAuth provider button.
 *
 * The server's ``/api/auth/oauth/start/{slot}`` endpoint will mint state and
 * 302 to the provider. We append ``next`` so the post-login callback can
 * land the user back where they were trying to go.
 */
export function oauthStartUrl(slot: string, next?: string): string {
  const base = `/api/auth/oauth/start/${encodeURIComponent(slot)}`;
  if (!next) return base;
  return `${base}?next=${encodeURIComponent(next)}`;
}

export function fetchWhoami(signal?: AbortSignal): Promise<WhoamiResponse> {
  return api.get<WhoamiResponse>("/api/auth/whoami", { signal });
}

export function login(username: string, password: string): Promise<LoginResponse> {
  return api.post<LoginResponse>("/api/auth/login", { username, password });
}

export function logout(): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>("/api/auth/logout");
}

export function setup(username: string, password: string): Promise<SetupResponse> {
  return api.post<SetupResponse>("/api/auth/setup", { username, password });
}

export function changePassword(oldPassword: string, newPassword: string): Promise<{ ok: boolean }> {
  return api.post<{ ok: boolean }>("/api/auth/change-password", {
    old_password: oldPassword,
    new_password: newPassword,
  });
}
