import { createFileRoute } from "@tanstack/react-router";
import { Layers, Radio, Skull } from "lucide-react";
import { PageHeader } from "@/components/layout";
import { StatCard } from "@/components/ui";
import { TopicsTable, topicsQuery, topicTotals, useTopics } from "@/features/topics";
import { formatCount } from "@/lib/number";

export const Route = createFileRoute("/topics")({
  loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(topicsQuery()),
  component: TopicsPage,
});

function TopicsPage() {
  const topics = useTopics();
  const data = topics.data;

  const { topics: totalTopics, backlog: totalBacklog, dead: totalDead } = topicTotals(data);

  return (
    <div className="flex flex-col gap-[var(--page-gap)]">
      <PageHeader
        eyebrow="Monitoring"
        title="Topics"
        description="Fan-out pub/sub topics and per-subscriber backlog."
      />
      <div className="grid gap-[var(--gap)] grid-cols-[repeat(auto-fit,minmax(186px,1fr))]">
        <StatCard label="Topics" tone="neutral" icon={<Radio />} value={formatCount(totalTopics)} />
        <StatCard
          label="Total backlog"
          tone="info"
          icon={<Layers />}
          value={formatCount(totalBacklog)}
          hint="pending + running"
        />
        <StatCard
          label="Dead"
          tone="warning"
          icon={<Skull />}
          value={formatCount(totalDead)}
          hint="across subscribers"
        />
      </div>
      <TopicsTable
        topics={data}
        loading={topics.isLoading}
        error={topics.error}
        onRetry={() => topics.refetch()}
      />
    </div>
  );
}
