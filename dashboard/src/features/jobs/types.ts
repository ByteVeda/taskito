import type * as v from "valibot";
import type { jobFiltersSchema, jobListSearchSchema } from "./search-schema";

/**
 * Filter criteria for listing jobs. Inferred from the valibot schema so the
 * runtime validator and compile-time type stay in sync.
 */
export type JobFilters = v.InferOutput<typeof jobFiltersSchema>;

/**
 * Full shape of the `/jobs` URL search params: filters plus pagination.
 */
export type JobListQuery = v.InferOutput<typeof jobListSearchSchema>;
