import { createFileRoute } from "@tanstack/react-router";
// Import query helpers from the hooks module directly (not the feature
// barrel) so the non-lazy route file doesn't drag Recharts into the main
// bundle.
import { metricsSummaryQuery, metricsTimeseriesQuery } from "@/features/metrics/hooks";
import { parseMetricsSearch } from "@/features/metrics/search-schema";

// Component lives in the `.lazy.tsx` counterpart so Recharts only loads when
// the user actually opens the metrics screen. Keeping this file
// component-less lets TanStack's lazy-route convention kick in.
export const Route = createFileRoute("/metrics")({
  validateSearch: parseMetricsSearch,
  loaderDeps: ({ search }) => ({ search }),
  loader: ({ context: { queryClient }, deps: { search } }) =>
    Promise.all([
      queryClient.ensureQueryData(metricsSummaryQuery(search.range, search.task)),
      queryClient.ensureQueryData(metricsTimeseriesQuery(search.range, search.task)),
    ]),
});
