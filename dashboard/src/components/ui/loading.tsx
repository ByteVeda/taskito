export function Loading() {
  return (
    <div class="flex items-center justify-center py-20">
      <div class="flex items-center gap-3 text-muted text-sm">
        <div class="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
        <span>Loading\u2026</span>
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div class="dark:bg-surface-2 bg-white rounded-xl shadow-sm dark:shadow-black/20 overflow-hidden border dark:border-white/[0.06] border-slate-200">
      <div class="h-10 dark:bg-surface-3/50 bg-slate-50 border-b dark:border-white/[0.04] border-slate-100" />
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          class="flex items-center gap-4 px-4 py-3.5 border-b dark:border-white/[0.03] border-slate-50 last:border-0"
        >
          <div class="h-3.5 rounded-md animate-shimmer flex-[2]" />
          <div class="h-3.5 rounded-md animate-shimmer flex-[3]" />
          <div class="h-3.5 rounded-md animate-shimmer flex-[1]" />
          <div class="h-3.5 rounded-md animate-shimmer flex-[2]" />
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div class="dark:bg-surface-2 bg-white rounded-xl shadow-sm dark:shadow-black/20 p-5 border dark:border-white/[0.06] border-slate-200">
      <div class="h-4 w-24 rounded animate-shimmer mb-4" />
      <div class="h-8 w-16 rounded animate-shimmer mb-2" />
      <div class="h-3 w-20 rounded animate-shimmer" />
    </div>
  );
}
