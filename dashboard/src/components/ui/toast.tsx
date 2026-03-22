import { CheckCircle2, Info, X, XCircle } from "lucide-preact";
import { dismissToast, type Toast, toasts } from "../../hooks/use-toast";

const TYPE_CONFIG: Record<
  Toast["type"],
  { border: string; icon: typeof CheckCircle2; iconColor: string }
> = {
  success: { border: "border-l-success", icon: CheckCircle2, iconColor: "text-success" },
  error: { border: "border-l-danger", icon: XCircle, iconColor: "text-danger" },
  info: { border: "border-l-info", icon: Info, iconColor: "text-info" },
};

export function ToastContainer() {
  const items = toasts.value;
  if (!items.length) return null;

  return (
    <div class="fixed bottom-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm">
      {items.map((t) => {
        const config = TYPE_CONFIG[t.type];
        const Icon = config.icon;
        return (
          <div
            key={t.id}
            class={`flex items-start gap-3 border-l-[3px] ${config.border} rounded-lg px-4 py-3.5 text-[13px] dark:bg-surface-2 bg-white shadow-xl dark:shadow-black/40 dark:text-gray-200 text-slate-700 animate-slide-in border dark:border-white/[0.06] border-slate-200`}
            role="alert"
          >
            <Icon class={`w-4.5 h-4.5 ${config.iconColor} shrink-0 mt-0.5`} strokeWidth={2} />
            <span class="flex-1">{t.message}</span>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              class="text-muted hover:dark:text-white hover:text-slate-900 transition-colors border-none bg-transparent cursor-pointer p-0.5"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
