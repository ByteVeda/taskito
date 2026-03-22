import { effect, signal } from "@preact/signals";

type Theme = "dark" | "light";

const stored = localStorage.getItem("taskito-theme") as Theme | null;

export const theme = signal<Theme>(stored ?? "dark");

effect(() => {
  const root = document.documentElement;
  if (theme.value === "dark") {
    root.classList.add("dark");
    root.classList.remove("light");
  } else {
    root.classList.remove("dark");
    root.classList.add("light");
  }
  localStorage.setItem("taskito-theme", theme.value);
});

export function toggleTheme(): void {
  theme.value = theme.value === "dark" ? "light" : "dark";
}
