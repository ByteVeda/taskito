import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli/index.ts",
    "contrib/otel": "src/contrib/otel.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  shims: true,
  clean: true,
  sourcemap: true,
  target: "node18",
  outDir: "dist",
});
