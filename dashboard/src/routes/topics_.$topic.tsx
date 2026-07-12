import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/layout";
import { SubscriptionsTable, topicDetailQuery, useTopicDetail } from "@/features/topics";

export const Route = createFileRoute("/topics_/$topic")({
  loader: ({ context: { queryClient }, params: { topic } }) =>
    queryClient.ensureQueryData(topicDetailQuery(topic)),
  component: TopicDetailPage,
});

function TopicDetailPage() {
  const { topic } = Route.useParams();
  const detail = useTopicDetail(topic);

  return (
    <div className="flex flex-col gap-[var(--page-gap)]">
      <PageHeader
        title={topic}
        description="Independent subscribers fanning out from this topic."
        breadcrumbs={[{ label: "Topics", to: "/topics" }, { label: topic }]}
      />
      <SubscriptionsTable
        subscriptions={detail.data}
        loading={detail.isLoading}
        error={detail.error}
        onRetry={() => detail.refetch()}
      />
    </div>
  );
}
