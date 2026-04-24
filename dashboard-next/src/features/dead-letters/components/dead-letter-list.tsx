import { Skull } from "lucide-react";
import { useMemo } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import type { DeadLetter } from "@/lib/api-types";
import { groupByError } from "../utils";
import { DeadLetterGroupRow } from "./dead-letter-group-row";
import { DeadLetterRow } from "./dead-letter-row";

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
        icon={Skull}
        title="No dead letters"
        description="Jobs that exhaust their retries land here."
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

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <DeadLetterRow key={item.id} item={item} />
      ))}
    </div>
  );
}
