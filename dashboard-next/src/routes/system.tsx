import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout";
import {
  InterceptionTable,
  ProxyTable,
  useInterceptionStats,
  useProxyStats,
} from "@/features/system";

export const Route = createFileRoute("/system")({
  component: SystemPage,
});

function SystemPage() {
  const proxy = useProxyStats();
  const interception = useInterceptionStats();

  return (
    <>
      <PageHeader
        title="System"
        description="Proxy reconstruction and argument interception metrics."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-tight text-[var(--fg)]">Proxy handlers</h2>
          <ProxyTable
            stats={proxy.data}
            loading={proxy.isLoading}
            error={proxy.error}
            onRetry={() => proxy.refetch()}
          />
        </section>
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold tracking-tight text-[var(--fg)]">
            Interception strategies
          </h2>
          <InterceptionTable
            stats={interception.data}
            loading={interception.isLoading}
            error={interception.error}
            onRetry={() => interception.refetch()}
          />
        </section>
      </div>
    </>
  );
}
