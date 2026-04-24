import { createFileRoute } from "@tanstack/react-router";
import { Clock, ListTree, Pause, Play, Skull } from "lucide-react";
import { PageHeader } from "@/components/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/")({
  component: OverviewPage,
});

const STATS = [
  { key: "pending", label: "Pending", icon: Clock, tone: "text-[var(--fg-muted)]" },
  { key: "running", label: "Running", icon: Play, tone: "text-info" },
  { key: "completed", label: "Completed", icon: ListTree, tone: "text-success" },
  { key: "failed", label: "Failed / dead", icon: Skull, tone: "text-danger" },
  { key: "paused", label: "Paused queues", icon: Pause, tone: "text-warning" },
] as const;

function OverviewPage() {
  return (
    <>
      <PageHeader
        eyebrow="Dashboard"
        title="Overview"
        description="A live pulse on your queues, jobs, and workers."
      />
      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
        {STATS.map(({ key, label, icon: Icon, tone }) => (
          <Card key={key}>
            <CardHeader className="flex-row items-center justify-between pb-1">
              <CardTitle>{label}</CardTitle>
              <Icon className={`size-4 ${tone}`} aria-hidden />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
