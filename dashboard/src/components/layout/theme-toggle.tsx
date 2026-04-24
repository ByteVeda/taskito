import { Laptop, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { type Theme, useTheme } from "@/providers";

const OPTIONS: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Laptop },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div
      role="toolbar"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 rounded-md bg-[var(--surface-2)] p-0.5 ring-1 ring-inset ring-[var(--border)]"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = theme === value;
        return (
          <Button
            key={value}
            variant="ghost"
            size="icon"
            aria-pressed={active}
            aria-label={label}
            onClick={() => setTheme(value)}
            className={cn(
              "size-7 rounded-sm",
              active
                ? "bg-[var(--surface)] text-[var(--fg)] shadow-xs"
                : "text-[var(--fg-subtle)] hover:bg-transparent",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </Button>
        );
      })}
    </div>
  );
}
