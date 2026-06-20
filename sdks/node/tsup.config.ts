import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli/index.ts",
    "contrib/otel": "src/contrib/otel.ts",
    "contrib/prometheus": "src/contrib/prometheus.ts",
    "contrib/express": "src/contrib/express.ts",
    "contrib/fastify": "src/contrib/fastify.ts",
    "contrib/nest": "src/contrib/nest.ts",
    "contrib/sentry": "src/contrib/sentry.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  shims: true,
  clean: true,
  sourcemap: true,
  target: "node18",
  outDir: "dist",
});
