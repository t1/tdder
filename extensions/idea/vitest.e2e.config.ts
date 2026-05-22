import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/e2e/**/*.e2e.ts"],
    fileParallelism: false, // E2E must be serial — avoid fixture/connection collisions
    testTimeout: 15_000,
    hookTimeout: 15_000,
    reporters: ["verbose"],
  },
});
