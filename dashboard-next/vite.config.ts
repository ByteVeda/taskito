import path from "node:path";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const backend = "http://127.0.0.1:8080";

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
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
    outDir: "../py_src/taskito/static/dashboard",
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
