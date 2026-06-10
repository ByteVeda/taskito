import { createFileRoute } from "@tanstack/react-router";
import { Clock, List, ListTree, Rows3, Skull, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout";
import { Button, DestructiveConfirmDialog, Pagination, StatCard } from "@/components/ui";
import {
  DeadLetterList,
  type DeadLetterView,
  deadLettersQuery,
  useDeadLetters,
  usePurgeDeadLetters,
} from "@/features/dead-letters";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/number";
import { formatRelative } from "@/lib/time";

const PAGE_SIZE = 25;
const DEAD_LETTER_VIEWS: readonly DeadLetterView[] = ["grouped", "flat"];

interface DeadLetterSearch {
  page: number;
  view: DeadLetterView;
}

function parseDeadLetterSearch(raw: Record<string, unknown>): DeadLetterSearch {
  const pageRaw = Number(raw.page);
  const page = Number.isFinite(pageRaw) && pageRaw >= 0 ? Math.floor(pageRaw) : 0;
  const view = DEAD_LETTER_VIEWS.find((v) => v === raw.view) ?? "grouped";
  return { page, view };
}

export const Route = createFileRoute("/dead-letters")({
  validateSearch: parseDeadLetterSearch,
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: ({ context: { queryClient }, deps: { page } }) =>
    queryClient.ensureQueryData(deadLettersQuery(page, PAGE_SIZE)),
  component: DeadLettersPage,
});

function DeadLettersPage() {
  const { page, view } = Route.useSearch();
  const navigate = Route.useNavigate();
  const setPage = (next: number) => {
    navigate({ search: (prev) => ({ ...prev, page: next }) });
  };
  const setView = (next: DeadLetterView) => {
    navigate({ search: (prev) => ({ ...prev, view: next, page: 0 }), replace: true });
  };

  const [confirmPurge, setConfirmPurge] = useState(false);

  const query = useDeadLetters(page, PAGE_SIZE);
  const purge = usePurgeDeadLetters();

  const items = query.data;
  const hasMore = items ? items.length >= PAGE_SIZE : false;

  const { taskCount, oldestFailedAt } = useMemo(() => {
    const tasks = new Set<string>();
    let oldest: number | null = null;
    for (const item of items ?? []) {
      tasks.add(item.task_name);
      if (oldest == null || item.failed_at < oldest) oldest = item.failed_at;
    }
    return { taskCount: tasks.size, oldestFailedAt: oldest };
  }, [items]);

  return (
    <>
      <div className="flex flex-col gap-[var(--page-gap)]">
        <PageHeader
          eyebrow="Reliability"
          title="Dead letters"
          description="Jobs that exhausted every retry. Inspect the failure, replay them, or let them go."
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
        <div className="grid gap-[var(--gap)] grid-cols-[repeat(auto-fit,minmax(186px,1fr))]">
          <StatCard
            label="On this page"
            tone="danger"
            icon={<Skull />}
            value={formatCount(items?.length ?? 0)}
            hint="awaiting a decision"
          />
          <StatCard
            label="Affected tasks"
            tone="warning"
            icon={<ListTree />}
            value={formatCount(taskCount)}
            hint="on this page"
          />
          <StatCard
            label="Oldest on this page"
            tone="neutral"
            icon={<Clock />}
            value={oldestFailedAt != null ? formatRelative(oldestFailedAt) : "—"}
          />
        </div>
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
