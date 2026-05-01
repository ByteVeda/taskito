import { useEffect } from "react";
import { site } from "@/lib/site";
import { useSettings } from "./hooks";
import { SETTING_KEYS } from "./types";

/**
 * Resolved branding values. Falls back to the bundled defaults when no
 * override is configured; never returns an empty string.
 */
export function useBranding(): { title: string } {
  const { data } = useSettings();
  const override = data?.[SETTING_KEYS.brandTitle]?.trim();
  return { title: override || site.name };
}

/**
 * Apply the configured accent color as a CSS variable on the root
 * element. Invalid colors are silently ignored — the dashboard keeps
 * the bundled default rather than producing broken styling.
 *
 * The dim variant (used for muted badges and hover states) is derived
 * via ``color-mix`` so the override stays coherent with the base color.
 */
export function useApplyAccent(): void {
  const { data } = useSettings();
  const value = data?.[SETTING_KEYS.brandAccent]?.trim();
  useEffect(() => {
    const root = document.documentElement;
    if (!value || !CSS.supports("color", value)) {
      root.style.removeProperty("--color-accent");
      root.style.removeProperty("--color-accent-dim");
      return;
    }
    root.style.setProperty("--color-accent", value);
    root.style.setProperty("--color-accent-dim", `color-mix(in srgb, ${value} 18%, transparent)`);
    return () => {
      root.style.removeProperty("--color-accent");
      root.style.removeProperty("--color-accent-dim");
    };
  }, [value]);
}
