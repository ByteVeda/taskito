import { CheckCircle2 } from "lucide-react";
import { useMemo } from "react";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui";
import type { DeadLetter } from "@/lib/api-types";
import { groupByError } from "../utils";
import { DeadLetterGroupRow } from "./dead-letter-group-row";
import { DeadLetterTable } from "./dead-letter-table";

export type DeadLetterView = "flat" | "grouped";

interface DeadLetterListProps {
  items: DeadLetter[] | undefined;
  view: DeadLetterView;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}

export function DeadLetterList({ items, view, loading, error, onRetry }: DeadLetterListProps) {
  const groups = useMemo(
    () => (view === "grouped" && items ? groupByError(items) : []),
    [view, items],
  );

  if (error) {
    return (
      <ErrorState
        title="Couldn't load dead letters"
        description={error.message}
        onRetry={onRetry}
      />
    );
  }

  if (loading && !items) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (!items || items.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="Nothing dead here"
        description="Every job has been replayed or discarded. Nice and tidy."
      />
    );
  }

  if (view === "grouped") {
    return (
      <div className="flex flex-col gap-2">
        {groups.map((g) => (
          <DeadLetterGroupRow key={g.key} group={g} />
        ))}
      </div>
    );
  }

  return <DeadLetterTable items={items} />;
}
