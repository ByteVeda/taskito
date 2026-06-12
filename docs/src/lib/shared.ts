export const appName = "Taskito";
export const docsRoute = "/";
export const docsImageRoute = "/og";
export const docsContentRoute = "/llms.mdx";

// Raw href strings (markdown/OG routes) are not run through Next's router,
// so basePath is not auto-applied — prepend it ourselves when deployed under
// a sub-path (e.g. /taskito on GitHub Pages).
export const basePath = process.env.NEXT_PUBLIC_DOCS_BASE_PATH ?? "";

export const gitConfig = {
  user: "ByteVeda",
  repo: "taskito",
  branch: "master",
};
