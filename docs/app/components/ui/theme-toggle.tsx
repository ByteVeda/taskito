import { Moon, Sun } from "lucide-react";
import { toggleTheme } from "@/lib/theme";

/** Nav theme switch. Icons are CSS-gated by `[data-theme]` (see app.css). */
export function ThemeToggle() {
  return (
    <button
      type="button"
      className="icon-btn theme-toggle"
      aria-label="Toggle color theme"
      onClick={toggleTheme}
    >
      <Moon className="moon" size={17} />
      <Sun className="sun" size={17} />
    </button>
  );
}
