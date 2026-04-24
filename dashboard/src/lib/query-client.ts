import { QueryClient } from "@tanstack/react-query";

/**
 * Factory for the app-wide {@link QueryClient}.
 *
 * Call once at bootstrap — both the React tree (via `QueryProvider`) and the
 * router context (for `route.loader` → `ensureQueryData`) must share the same
 * instance so loader-primed caches are visible to in-component `useQuery`.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          const status = (error as { status?: number }).status;
          if (status && status >= 400 && status < 500) return false;
          return failureCount < 2;
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}
