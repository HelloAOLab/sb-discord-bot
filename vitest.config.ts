import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Sets fake env vars (with a real test signing key) before src/config.ts is imported.
    setupFiles: ["test/setup.ts"],
    restoreMocks: true,
  },
});
