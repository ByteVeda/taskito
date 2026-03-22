import { RefreshCw, WifiOff } from "lucide-preact";
import { Button } from "./button";

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div class="flex flex-col items-center justify-center py-20 text-center">
      <div class="w-14 h-14 rounded-2xl dark:bg-danger/10 bg-danger/5 flex items-center justify-center mb-5">
        <WifiOff class="w-7 h-7 text-danger" strokeWidth={1.5} />
      </div>
      <p class="text-sm font-medium dark:text-gray-200 text-slate-700 mb-1">Unable to load data</p>
      <p class="text-xs text-muted max-w-xs mb-5">{message}</p>
      {onRetry && (
        <Button variant="ghost" onClick={onRetry}>
          <RefreshCw class="w-3.5 h-3.5" />
          Retry
        </Button>
      )}
    </div>
  );
}
