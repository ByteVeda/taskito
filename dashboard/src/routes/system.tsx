import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, SectionHeading } from "@/components/layout";
import {
  InterceptionTable,
  interceptionStatsQuery,
  ProxyTable,
  proxyStatsQuery,
  useInterceptionStats,
  useProxyStats,
} from "@/features/system";

export const Route = createFileRoute("/system")({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(proxyStatsQuery()),
      queryClient.ensureQueryData(interceptionStatsQuery()),
    ]),
  component: SystemPage,
});

function SystemPage() {
  const proxy = useProxyStats();
  const interception = useInterceptionStats();

  return (
    <div className="flex flex-col gap-[var(--page-gap)]">
      <PageHeader
        eyebrow="Reliability"
        title="System"
        description="Core internals — resource-proxy reconstruction and call interception."
      />
      <section>
        <SectionHeading
          title="Resource proxies"
          action={
            <span className="text-xs text-[var(--fg-subtle)]">
              reconstructed across worker boundaries
            </span>
          }
        />
        <ProxyTable
          stats={proxy.data}
          loading={proxy.isLoading}
          error={proxy.error}
          onRetry={() => proxy.refetch()}
        />
      </section>

      <section>
        <SectionHeading title="Call interception" />
        <InterceptionTable
          stats={interception.data}
          loading={interception.isLoading}
          error={interception.error}
          onRetry={() => interception.refetch()}
        />
      </section>
    </div>
  );
}
