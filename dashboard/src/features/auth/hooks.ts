import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api-client";
import {
  changePassword,
  fetchAuthStatus,
  fetchProviders,
  fetchWhoami,
  login,
  logout,
  setup,
} from "./api";
import type { WhoamiResponse } from "./types";

export const AUTH_STATUS_KEY = ["auth", "status"] as const;
export const WHOAMI_KEY = ["auth", "whoami"] as const;
export const PROVIDERS_KEY = ["auth", "providers"] as const;

export function authStatusQuery() {
  return queryOptions({
    queryKey: AUTH_STATUS_KEY,
    queryFn: ({ signal }) => fetchAuthStatus(signal),
    staleTime: 60_000,
  });
}

/**
 * Resolve the current session. ``data`` is ``null`` when no session is
 * active (the server returns 401, which we trap so the rest of the app can
 * test for ``data === null`` without a try/catch).
 */
export function whoamiQuery() {
  return queryOptions({
    queryKey: WHOAMI_KEY,
    queryFn: async ({ signal }): Promise<WhoamiResponse | null> => {
      try {
        return await fetchWhoami(signal);
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 404)) {
          return null;
        }
        throw e;
      }
    },
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        return false;
      }
      return failureCount < 2;
    },
  });
}

/** List of OAuth providers exposed by the server. */
export function providersQuery() {
  return queryOptions({
    queryKey: PROVIDERS_KEY,
    queryFn: ({ signal }) => fetchProviders(signal),
    staleTime: 60_000,
  });
}

export function useAuthStatus() {
  return useQuery(authStatusQuery());
}

export function useWhoami() {
  return useQuery(whoamiQuery());
}

export function useAuthProviders() {
  return useQuery(providersQuery());
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      login(username, password),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: WHOAMI_KEY });
      await qc.invalidateQueries({ queryKey: AUTH_STATUS_KEY });
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSettled: async () => {
      qc.setQueryData(WHOAMI_KEY, null);
      // Drop every cached query — there will be no further data to show
      // until the user logs back in.
      qc.clear();
    },
  });
}

export function useSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      setup(username, password),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: AUTH_STATUS_KEY });
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: ({ oldPassword, newPassword }: { oldPassword: string; newPassword: string }) =>
      changePassword(oldPassword, newPassword),
  });
}
