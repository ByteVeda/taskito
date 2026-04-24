import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout";
import { Pagination } from "@/components/ui";
import { JobFiltersBar, JobSearchBar, JobTable, useJobs } from "@/features/jobs";
import type { JobFilters, JobListQuery } from "@/features/jobs/types";
import { parseJobListSearch } from "@/features/jobs/utils";

export const Route = createFileRoute("/jobs/")({
  component: JobsListPage,
  validateSearch: (search) => parseJobListSearch(search),
});

function JobsListPage() {
  const search = Route.useSearch() as JobListQuery;
  const navigate = Route.useNavigate();

  const updateFilters = (filters: JobFilters) => {
    navigate({
      search: (prev) => ({
        ...(prev as JobListQuery),
        ...filters,
        // Reset to first page whenever filters change
        page: 0,
      }),
      replace: true,
    });
  };

  const setPage = (page: number) => {
    navigate({ search: (prev) => ({ ...(prev as JobListQuery), page }) });
  };

  const jobs = useJobs(search);
  const data = jobs.data;
  const hasMore = data ? data.length >= search.pageSize : false;

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Browse, filter, and act on task executions."
        actions={<JobSearchBar className="w-full md:w-[280px]" />}
      />

      <div className="flex flex-col gap-4">
        <JobFiltersBar filters={search} onChange={updateFilters} />
        <JobTable
          jobs={data}
          loading={jobs.isLoading || (jobs.isFetching && !data)}
          error={jobs.error}
          onRetry={() => jobs.refetch()}
        />
        <Pagination page={search.page} hasMore={hasMore} onChange={setPage} />
      </div>
    </>
  );
}
