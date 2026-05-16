import { api } from "@/lib/api-client";
import type { AuthStatus, LoginResponse, SetupResponse, WhoamiResponse } from "./types";

export function fetchAuthStatus(signal?: AbortSignal): Promise<AuthStatus> {
  return api.get<AuthStatus>("/api/auth/status", { signal });
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
