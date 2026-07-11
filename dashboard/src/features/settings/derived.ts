import { useEffect } from "react";
import { site } from "@/lib/site";
import { useSettings } from "./hooks";
import { type ExternalLink, type IntegrationUrls, SETTING_KEYS } from "./types";

/**
 * Whether a configured URL may safely become an ``href``. Allows http(s)
 * and same-origin paths only — a stored ``javascript:``/``data:`` URI would
 * execute in the dashboard origin when clicked, so scheme filtering here is
 * the security control (the ``type="url"`` inputs are UX only and settings
 * can be written directly through the API).
 */
export function isSafeLinkUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("/")) return !trimmed.startsWith("//");
  try {
    const protocol = new URL(trimmed).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Parse the JSON-encoded ``external_links`` setting into a typed list,
 * tolerating malformed values (returns ``[]``) so a bad write never
 * breaks the page. Entries with unsafe URL schemes are dropped.
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
          typeof (item as ExternalLink).url === "string" &&
          isSafeLinkUrl((item as ExternalLink).url),
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

/** Configured integration URLs — normalized and dropped unless scheme-safe. */
export function useIntegrations(): IntegrationUrls {
  const { data } = useSettings();
  const sanitize = (raw: string | undefined): string => {
    const value = raw?.trim() ?? "";
    return value && isSafeLinkUrl(value) ? value : "";
  };
  return {
    grafana: sanitize(data?.[SETTING_KEYS.integrationGrafana]),
    sentry: sanitize(data?.[SETTING_KEYS.integrationSentry]),
    otel: sanitize(data?.[SETTING_KEYS.integrationOtel]),
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
