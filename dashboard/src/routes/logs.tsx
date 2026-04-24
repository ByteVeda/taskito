import { createFileRoute } from "@tanstack/react-router";
// Import query helpers from the hooks module directly (not the feature
// barrel) so the non-lazy route file doesn't drag the virtualized log
// components into the main bundle.
import { logsListQuery } from "@/features/logs/hooks";
import {
  LOGS_DEFAULT_SINCE_SECONDS,
  LOGS_PAGE_SIZE,
  parseLogsSearch,
} from "@/features/logs/search-schema";

// Lazy route: the virtual-list + log stream load only on demand. See
// `logs.lazy.tsx` for the actual component.
export const Route = createFileRoute("/logs")({
  validateSearch: parseLogsSearch,
  loaderDeps: ({ search }) => ({ search }),
  loader: ({ context: { queryClient }, deps: { search } }) =>
    queryClient.ensureQueryData(
      logsListQuery({
        task: search.task,
        level: search.level,
        sinceSeconds: LOGS_DEFAULT_SINCE_SECONDS,
        limit: LOGS_PAGE_SIZE,
      }),
    ),
});
