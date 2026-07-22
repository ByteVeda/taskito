import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout";
import { ErrorState, Skeleton } from "@/components/ui";
import {
  BrandingSection,
  ExternalLinksSection,
  IntegrationsSection,
  RefreshIntervalSection,
  RetentionSection,
  retentionQuery,
  settingsQuery,
  useSettings,
} from "@/features/settings";

export const Route = createFileRoute("/settings")({
  loader: ({ context: { queryClient } }) => {
    // Retention is one read-only panel: prefetch it best-effort so a backend
    // that can't report its windows never costs the operator the whole page
    // (branding, integrations, links). `prefetchQuery` resolves on failure;
    // the section renders its own error state from the cached rejection.
    void queryClient.prefetchQuery(retentionQuery());
    return queryClient.ensureQueryData(settingsQuery());
  },
  component: SettingsPage,
});

function SettingsPage() {
  const { data, isLoading, error, refetch } = useSettings();

  return (
    <div className="flex flex-col gap-[var(--page-gap)]">
      <PageHeader
        eyebrow="Configuration"
        title="Settings"
        description="Branding, dashboard behaviour, retention, integrations, and quick links — shared across every worker."
      />

      {isLoading || !data ? (
        <div className="flex flex-col gap-[var(--gap)]">
          <Skeleton className="h-48 rounded-[var(--card-radius)]" />
          <Skeleton className="h-48 rounded-[var(--card-radius)]" />
          <Skeleton className="h-64 rounded-[var(--card-radius)]" />
        </div>
      ) : error ? (
        <ErrorState
          title="Couldn't load settings"
          description={error instanceof Error ? error.message : String(error)}
          onRetry={() => refetch()}
        />
      ) : (
        <div className="flex flex-col gap-[var(--gap)]">
          <BrandingSection settings={data} />
          <RefreshIntervalSection />
          <RetentionSection />
          <IntegrationsSection settings={data} />
          <ExternalLinksSection settings={data} />
        </div>
      )}
    </div>
  );
}
