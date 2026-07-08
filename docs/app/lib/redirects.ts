// Old → new doc URLs after the shared-content move (architecture + resources
// dropped their `/python` prefix). GitHub Pages has no server-side redirect
// rules, so each old path is prerendered as a stub that meta-refreshes (direct
// hits) and client-navigates (SPA) to its new home. Dependency-free: imported by
// both the client route and the build-time prerender config.

const ARCH_PAGES = [
  "",
  "overview",
  "job-lifecycle",
  "worker-pool",
  "scheduler",
  "mesh",
  "storage",
  "resources",
  "failure-model",
  "serialization",
];

// Sections that have child pages but no landing/index page. A bare hit on the
// section URL (e.g. from a breadcrumb crumb or an external link) would otherwise
// 404, so send it to the section's first page.
const SECTION_LANDINGS = ["node", "python", "java"].map(
  (sdk): [string, string] => [
    `/${sdk}/getting-started`,
    `/${sdk}/getting-started/installation`,
  ],
);

export const REDIRECTS: Record<string, string> = {
  ...Object.fromEntries(
    ARCH_PAGES.map((page) => {
      const suffix = page ? `/${page}` : "";
      return [`/python/architecture${suffix}`, `/architecture${suffix}`];
    }),
  ),
  ...Object.fromEntries(SECTION_LANDINGS),
  "/resources": "/resources/comparison",
  "/python/more/comparison": "/resources/comparison",
  "/python/more/faq": "/resources/faq",
  "/python/more/changelog": "/resources/changelog",
};

/** The destination for a moved path, or undefined if it isn't a redirect. */
export function redirectFor(path: string): string | undefined {
  return REDIRECTS[path.replace(/\/$/, "") || "/"];
}

/** Old paths to prerender as redirect stubs (so direct hits don't 404). */
export function redirectPaths(): string[] {
  return Object.keys(REDIRECTS);
}
