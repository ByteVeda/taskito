import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "@/providers/theme-provider";

export function Toaster(props: ToasterProps) {
  const { resolved } = useTheme();
  return (
    <Sonner
      theme={resolved}
      richColors
      closeButton
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-[var(--surface)] group-[.toaster]:text-[var(--fg)] group-[.toaster]:border-[var(--border-strong)] group-[.toaster]:shadow-xl",
          description: "group-[.toast]:text-[var(--fg-muted)]",
          actionButton: "group-[.toast]:bg-accent group-[.toast]:text-accent-fg",
          cancelButton:
            "group-[.toast]:bg-[var(--surface-2)] group-[.toast]:text-[var(--fg-muted)]",
        },
      }}
      {...props}
    />
  );
}

export { toast } from "sonner";
