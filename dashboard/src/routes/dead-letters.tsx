import { createFileRoute } from "@tanstack/react-router";
import { List, Rows3, Trash2 } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/layout";
import { Button, DestructiveConfirmDialog, Pagination } from "@/components/ui";
import {
  DeadLetterList,
  type DeadLetterView,
  useDeadLetters,
  usePurgeDeadLetters,
} from "@/features/dead-letters";
import { cn } from "@/lib/cn";

const PAGE_SIZE = 25;

export const Route = createFileRoute("/dead-letters")({
  component: DeadLettersPage,
});

function DeadLettersPage() {
  const [page, setPage] = useState(0);
  const [view, setView] = useState<DeadLetterView>("grouped");
  const [confirmPurge, setConfirmPurge] = useState(false);

  const query = useDeadLetters(page, PAGE_SIZE);
  const purge = usePurgeDeadLetters();

  const items = query.data;
  const hasMore = items ? items.length >= PAGE_SIZE : false;

  return (
    <>
      <PageHeader
        title="Dead letters"
        description="Failures that exhausted their retries. Retry individually or purge all."
        actions={
          <>
            <ViewToggle value={view} onChange={setView} />
            <Button
              variant="danger"
              size="sm"
              onClick={() => setConfirmPurge(true)}
              disabled={purge.isPending || !items || items.length === 0}
            >
              <Trash2 aria-hidden /> Purge all
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-4">
        <DeadLetterList
          items={items}
          view={view}
          loading={query.isLoading || (query.isFetching && !items)}
          error={query.error}
          onRetry={() => query.refetch()}
        />
        <Pagination page={page} hasMore={hasMore} onChange={setPage} />
      </div>

      <DestructiveConfirmDialog
        open={confirmPurge}
        onOpenChange={setConfirmPurge}
        title="Purge all dead letters?"
        description="This permanently removes every dead-letter entry. Retries and history are lost. This cannot be undone."
        confirmPhrase="purge"
        confirmLabel="Purge all"
        pending={purge.isPending}
        onConfirm={async () => {
          await purge.mutateAsync();
        }}
      />
    </>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: DeadLetterView;
  onChange: (v: DeadLetterView) => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="View"
      className="inline-flex items-center gap-0.5 rounded-md bg-[var(--surface-2)] p-0.5 ring-1 ring-inset ring-[var(--border)]"
    >
      <ToggleBtn active={value === "grouped"} onClick={() => onChange("grouped")} label="Grouped">
        <Rows3 className="size-3.5" aria-hidden />
      </ToggleBtn>
      <ToggleBtn active={value === "flat"} onClick={() => onChange("flat")} label="Flat">
        <List className="size-3.5" aria-hidden />
      </ToggleBtn>
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-[var(--surface)] text-[var(--fg)] shadow-xs"
          : "text-[var(--fg-subtle)] hover:text-[var(--fg)]",
      )}
    >
      {children}
      {label}
    </button>
  );
}
