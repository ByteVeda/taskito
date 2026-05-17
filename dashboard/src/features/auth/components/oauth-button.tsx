import { KeyRound } from "lucide-react";
import { oauthStartUrl } from "../api";
import type { AuthProvider } from "../types";

interface OAuthButtonProps {
  provider: AuthProvider;
  /** Path to send the user to after a successful login. Validated server-side. */
  next?: string;
}

/** "Sign in with X" button — renders as a plain anchor so the browser
 * follows the 302 from ``/api/auth/oauth/start/{slot}`` natively.
 *
 * Styling matches the dashboard's design system without depending on the
 * primary :class:`Button` component (we need anchor semantics, not button).
 */
export function OAuthButton({ provider, next }: OAuthButtonProps) {
  return (
    <a
      href={oauthStartUrl(provider.slot, next)}
      className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 text-sm font-medium text-[var(--fg)] transition-colors hover:bg-[var(--surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-1)]"
      data-slot={provider.slot}
      data-type={provider.type}
    >
      <ProviderIcon type={provider.type} />
      <span>Continue with {provider.label}</span>
    </a>
  );
}

function ProviderIcon({ type }: { type: AuthProvider["type"] }) {
  if (type === "google") {
    return <GoogleGlyph />;
  }
  if (type === "github") {
    return <GitHubGlyph />;
  }
  // Generic OIDC — operator-configured SSO.
  return <KeyRound className="size-4" aria-hidden />;
}

/** Official Google "G" mark — inlined SVG so we don't pull in a brand-asset
 * dependency. Matches Google's brand guidelines for sign-in buttons.
 */
function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" role="img" aria-label="Google" focusable="false">
      <title>Google</title>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09a6.6 6.6 0 0 1 0-4.18V7.07H2.18a11 11 0 0 0 0 9.86l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.2 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

/** GitHub Octocat (Mark) — inlined so we don't depend on a brand-icon set
 * that might drop it (lucide-react 1.x removed brand icons).
 */
function GitHubGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4 fill-current"
      role="img"
      aria-label="GitHub"
      focusable="false"
    >
      <title>GitHub</title>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2.21c-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.73-1.54-2.55-.29-5.23-1.27-5.23-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.15 1.17a10.9 10.9 0 0 1 5.74 0c2.19-1.48 3.15-1.17 3.15-1.17.62 1.57.23 2.73.11 3.02.73.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.37-5.25 5.65.41.36.78 1.05.78 2.12v3.14c0 .31.21.67.79.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}
