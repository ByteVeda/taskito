import { ChevronLeft, ChevronRight } from "lucide-preact";

interface PaginationProps {
  page: number;
  pageSize: number;
  itemCount: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, pageSize, itemCount, onPageChange }: PaginationProps) {
  return (
    <div class="flex items-center justify-between px-4 py-3 text-[13px] text-muted border-t dark:border-white/[0.04] border-slate-100">
      <span>
        Showing {page * pageSize + 1}\u2013{page * pageSize + itemCount} items
      </span>
      <div class="flex gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page === 0}
          class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg dark:bg-surface-3 bg-slate-100 dark:text-gray-300 text-slate-600 border dark:border-white/[0.06] border-slate-200 disabled:opacity-30 cursor-pointer disabled:cursor-default hover:enabled:dark:bg-surface-4 hover:enabled:bg-slate-200 transition-all duration-150 text-[13px]"
        >
          <ChevronLeft class="w-3.5 h-3.5" />
          Prev
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={itemCount < pageSize}
          class="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg dark:bg-surface-3 bg-slate-100 dark:text-gray-300 text-slate-600 border dark:border-white/[0.06] border-slate-200 disabled:opacity-30 cursor-pointer disabled:cursor-default hover:enabled:dark:bg-surface-4 hover:enabled:bg-slate-200 transition-all duration-150 text-[13px]"
        >
          Next
          <ChevronRight class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
