import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

// Set `DOCS_BASE_PATH=/taskito` in CI to deploy under github.io/taskito.
// Local `pnpm build && pnpm start` leaves it unset, so the static export
// serves cleanly from the root and `serve out` just works.
const basePath = process.env.DOCS_BASE_PATH ?? "";

/** @type {import('next').NextConfig} */
const config = {
  output: "export",
  basePath,
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_DOCS_BASE_PATH: basePath,
  },
};

export default withMDX(config);
