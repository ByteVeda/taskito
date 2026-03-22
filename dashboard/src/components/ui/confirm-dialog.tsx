import { AlertTriangle } from "lucide-preact";
import { Button } from "./button";

interface ConfirmDialogProps {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onCancel}
    >
      <div
        class="dark:bg-surface-2 bg-white rounded-xl shadow-2xl dark:shadow-black/50 p-6 max-w-sm mx-4 border dark:border-white/[0.08] border-slate-200 animate-slide-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="flex items-start gap-3 mb-5">
          <div class="p-2 rounded-lg bg-danger-dim shrink-0">
            <AlertTriangle class="w-5 h-5 text-danger" strokeWidth={2} />
          </div>
          <p class="text-sm dark:text-gray-200 text-slate-700 pt-1">{message}</p>
        </div>
        <div class="flex justify-end gap-2.5">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Confirm
          </Button>
        </div>
      </div>
    </div>
  );
}
