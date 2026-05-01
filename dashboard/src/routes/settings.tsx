import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout";
import { ErrorState, Skeleton } from "@/components/ui";
import {
  BrandingSection,
  ExternalLinksSection,
  IntegrationsSection,
  settingsQuery,
  useSettings,
} from "@/features/settings";

export const Route = createFileRoute("/settings")({
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(settingsQuery()),
  component: SettingsPage,
});

function SettingsPage() {
  const { data, isLoading, error, refetch } = useSettings();

  return (
    <>
      <PageHeader
        title="Settings"
        description="Customize the dashboard's appearance and configure external integrations."
      />

      {isLoading || !data ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-48 rounded-lg" />
          <Skeleton className="h-48 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      ) : error ? (
        <ErrorState
          title="Couldn't load settings"
          description={error instanceof Error ? error.message : String(error)}
          onRetry={() => refetch()}
        />
      ) : (
        <div className="flex flex-col gap-6">
          <BrandingSection settings={data} />
          <ExternalLinksSection settings={data} />
          <IntegrationsSection settings={data} />
        </div>
      )}
    </>
  );
}
