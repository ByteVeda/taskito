import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

// `basePath` is only needed for the deployed GH Pages URL
// (docs.byteveda.org/taskito). In dev (`pnpm dev`) it makes `localhost:3000`
// 404 because the app moves to `localhost:3000/taskito`. Scope it to
// production so dev hits the root.
const isProd = process.env.NODE_ENV === "production";

/** @type {import('next').NextConfig} */
const config = {
  output: "export",
  basePath: isProd ? "/taskito" : "",
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
};

export default withMDX(config);
