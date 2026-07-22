import { useEffect } from "react";
import { site } from "@/lib/site";
import { useSettings } from "./hooks";
import {
  type ExternalLink,
  type IntegrationUrls,
  type RetentionWindows,
  SETTING_KEYS,
} from "./types";

/**
 * Whether a configured URL may safely become an ``href``. Allows http(s)
 * and same-origin paths only — a stored ``javascript:``/``data:`` URI would
 * execute in the dashboard origin when clicked, so scheme filtering here is
 * the security control (the ``type="url"`` inputs are UX only and settings
 * can be written directly through the API).
 */
export function isSafeLinkUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.startsWith("/")) {
    // Reject protocol-relative (//host) and backslashes: WHATWG URL parsing
    // normalizes "\" to "/" for http(s), so "/\evil.com" escapes the origin.
    return !trimmed.startsWith("//") && !trimmed.includes("\\");
  }
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

/**
 * The history tables auto-cleanup purges, ordered the way an operator reads
 * them: shortest-lived first, the dead-letter queue last. Each row explains
 * what disappears from which page when its window elapses.
 */
export const RETENTION_TABLES: ReadonlyArray<{
  key: keyof RetentionWindows;
  label: string;
  description: string;
}> = [
  {
    key: "task_logs_ttl_ms",
    label: "Task logs",
    description: "Per-job log lines shown on the Logs page and job detail.",
  },
  {
    key: "archived_jobs_ttl_ms",
    label: "Archived jobs",
    description: "Finished jobs of every terminal status — what job detail reads after completion.",
  },
  {
    key: "job_errors_ttl_ms",
    label: "Job errors",
    description: "Per-attempt failure records behind a job's error history.",
  },
  {
    key: "task_metrics_ttl_ms",
    label: "Task metrics",
    description: "The per-run timings the Metrics charts aggregate.",
  },
  {
    key: "dead_letter_ttl_ms",
    label: "Dead letters",
    description: "The only copy of a failed job's payload — deliberately kept longest.",
  },
];

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * A retention window as an operator-readable age. ``null`` is "kept forever"
 * (no window), which is not the same as a zero window — that purges a row as
 * soon as the cleaner sees it.
 */
export function formatRetentionWindow(ms: number | null): string {
  if (ms === null) return "Kept forever";
  if (ms <= 0) return "Purged immediately";
  const plural = (value: number, unit: string) => `${value} ${unit}${value === 1 ? "" : "s"}`;
  if (ms % DAY_MS === 0) return plural(ms / DAY_MS, "day");
  if (ms % HOUR_MS === 0) return plural(ms / HOUR_MS, "hour");
  if (ms % MINUTE_MS === 0) return plural(ms / MINUTE_MS, "minute");
  // Floor at one second: a sub-second window still keeps rows for a moment, and
  // rounding it to "0 seconds" would read as the immediate purge above.
  return plural(Math.max(1, Math.round(ms / 1000)), "second");
}
