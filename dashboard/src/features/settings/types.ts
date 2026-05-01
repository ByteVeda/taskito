/**
 * Dashboard settings types.
 *
 * Settings are stored server-side as a flat key→string map. The UI groups
 * them by category and JSON-encodes structured values (lists, integration
 * blobs) before persisting; the server stores them as opaque strings.
 *
 * See `py_src/taskito/dashboard/handlers/settings.py` for the REST API.
 */

/** Settings keys used by the dashboard UI. Keep them in one place so the
 * UI and any server-side defaults stay in sync. */
export const SETTING_KEYS = {
  brandTitle: "dashboard.brand.title",
  brandAccent: "dashboard.brand.accent",
  externalLinks: "dashboard.external_links",
  integrationGrafana: "dashboard.integrations.grafana_url",
  integrationSentry: "dashboard.integrations.sentry_url",
  integrationOtel: "dashboard.integrations.otel_url",
} as const;

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

/** A user-defined external link rendered in the sidebar. */
export interface ExternalLink {
  label: string;
  url: string;
}

/** Single-URL integration shortcuts surfaced on relevant pages. */
export interface IntegrationUrls {
  grafana: string;
  sentry: string;
  otel: string;
}

/** Branding overrides — empty strings mean "use the default". */
export interface BrandOverrides {
  title: string;
  accent: string;
}

/** Raw key→value snapshot returned by ``GET /api/settings``. */
export type SettingsSnapshot = Record<string, string>;
