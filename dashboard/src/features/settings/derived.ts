import { useEffect } from "react";
import { site } from "@/lib/site";
import { useSettings } from "./hooks";
import { type ExternalLink, type IntegrationUrls, SETTING_KEYS } from "./types";

/**
 * Parse the JSON-encoded ``external_links`` setting into a typed list,
 * tolerating malformed values (returns ``[]``) so a bad write never
 * breaks the page.
 */
export function parseExternalLinks(raw: string | undefined): ExternalLink[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is ExternalLink =>
          typeof item === "object" &&
          item !== null &&
          typeof (item as ExternalLink).label === "string" &&
          typeof (item as ExternalLink).url === "string",
      )
      .map((item) => ({ label: item.label, url: item.url }));
  } catch {
    return [];
  }
}

/** User-defined external links rendered in the sidebar. */
export function useExternalLinks(): ExternalLink[] {
  const { data } = useSettings();
  return parseExternalLinks(data?.[SETTING_KEYS.externalLinks]);
}

/** Configured integration URLs, with empty/whitespace values normalized. */
export function useIntegrations(): IntegrationUrls {
  const { data } = useSettings();
  return {
    grafana: data?.[SETTING_KEYS.integrationGrafana]?.trim() ?? "",
    sentry: data?.[SETTING_KEYS.integrationSentry]?.trim() ?? "",
    otel: data?.[SETTING_KEYS.integrationOtel]?.trim() ?? "",
  };
}

/**
 * Substitute supported placeholders in an integration URL template.
 *
 * Currently supports ``{job_id}``. URLs without any placeholder are
 * returned unchanged so users can configure either a templated deep
 * link or a static landing page.
 */
export function applyJobContext(template: string, jobId: string): string {
  return template.replaceAll("{job_id}", encodeURIComponent(jobId));
}

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
 * Apply the configured accent color by overriding the accent token set on
 * the root element. Invalid colors are silently ignored — the dashboard
 * keeps the bundled emerald rather than producing broken styling.
 *
 * We drive the base `--accent` (which `--color-accent` and every Tailwind
 * `*-accent` utility resolve through) plus the derived `-dim`/`-ink`/
 * `-strong`/ring variants via ``color-mix`` so the override stays coherent
 * across badges, buttons, links, and charts.
 */
const ACCENT_TOKENS = ["--accent", "--accent-dim", "--accent-ink", "--accent-strong", "--ring"];

export function useApplyAccent(): void {
  const { data } = useSettings();
  const value = data?.[SETTING_KEYS.brandAccent]?.trim();
  useEffect(() => {
    const root = document.documentElement;
    const clear = () => {
      for (const token of ACCENT_TOKENS) root.style.removeProperty(token);
    };
    if (!value || !CSS.supports("color", value)) {
      clear();
      return;
    }
    root.style.setProperty("--accent", value);
    root.style.setProperty("--accent-dim", `color-mix(in oklch, ${value} 16%, transparent)`);
    // Ink is the accent used as small text on the dim tint (badges, segmented).
    // It needs more contrast than the raw accent, so blend toward the theme's
    // foreground — which darkens it in light mode and lightens it in dark mode,
    // preserving the default --accent vs --accent-ink lightness shift.
    root.style.setProperty("--accent-ink", `color-mix(in oklch, ${value} 72%, var(--fg))`);
    root.style.setProperty("--accent-strong", value);
    root.style.setProperty("--ring", `color-mix(in oklch, ${value} 45%, transparent)`);
    return clear;
  }, [value]);
}
