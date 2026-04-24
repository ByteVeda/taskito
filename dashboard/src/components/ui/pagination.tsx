import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

interface PaginationProps {
  page: number;
  pageCount?: number;
  hasMore?: boolean;
  onChange: (page: number) => void;
  className?: string;
}

export function Pagination({ page, pageCount, hasMore, onChange, className }: PaginationProps) {
  const canNext = pageCount != null ? page < pageCount - 1 : Boolean(hasMore);
  const canPrev = page > 0;
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 text-xs text-[var(--fg-muted)]",
        className,
      )}
    >
      <span className="tabular-nums">
        Page <span className="font-medium text-[var(--fg)]">{page + 1}</span>
        {pageCount != null ? (
          <>
            {" "}
            of <span className="font-medium text-[var(--fg)]">{pageCount}</span>
          </>
        ) : null}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={!canPrev}
          onClick={() => onChange(Math.max(0, page - 1))}
        >
          <ChevronLeft aria-hidden />
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={!canNext} onClick={() => onChange(page + 1)}>
          Next
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </div>
  );
}
