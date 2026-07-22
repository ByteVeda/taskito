import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 15000,
    // Dashboard hooks seed a PBKDF2 session that outruns the 10s default on slow CI.
    hookTimeout: 15000,
  },
});
