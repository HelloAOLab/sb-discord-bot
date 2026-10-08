import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Gives every test a fresh in-memory database built from migrations/.
    setupFiles: ["test/setup.ts"],
    restoreMocks: true,
  },
});
