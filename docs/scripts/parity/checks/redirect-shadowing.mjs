import { REDIRECTS } from "../../../app/lib/redirects.ts";

// (d) The docs route resolves redirects BEFORE page loaders, so a REDIRECTS
// key that equals a real page slug makes that page silently unreachable.
// This bites exactly during name normalization (new shared page + redirect
// from the retired per-SDK name) — fail loudly instead.

export function checkRedirectShadowing(slugs) {
  const errors = [];
  for (const from of Object.keys(REDIRECTS)) {
    if (slugs.has(from)) {
      errors.push(
        `redirect source ${from} shadows the page from ${slugs.get(from)} (redirects win — the page is unreachable)`,
      );
    }
  }
  return { name: "Redirect shadowing", errors, report: [] };
}
