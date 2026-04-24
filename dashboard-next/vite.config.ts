import path from "node:path";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backend = "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/route-tree.gen.ts",
      quoteStyle: "double",
      semicolons: true,
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
  server: {
    proxy: {
      "/api": backend,
      "/health": backend,
      "/readiness": backend,
      "/metrics": backend,
    },
  },
});
