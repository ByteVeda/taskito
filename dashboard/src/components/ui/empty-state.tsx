import { Inbox } from "lucide-preact";

interface EmptyStateProps {
  message: string;
  subtitle?: string;
}

export function EmptyState({ message, subtitle }: EmptyStateProps) {
  return (
    <div class="flex flex-col items-center justify-center py-16 text-center">
      <div class="w-12 h-12 rounded-xl dark:bg-surface-3 bg-slate-100 flex items-center justify-center mb-4">
        <Inbox class="w-6 h-6 text-muted" strokeWidth={1.5} />
      </div>
      <p class="text-sm font-medium dark:text-gray-300 text-slate-600">{message}</p>
      {subtitle && (
        <p class="text-xs text-muted mt-1">{subtitle}</p>
      )}
    </div>
  );
}
