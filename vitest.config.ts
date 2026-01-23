import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";

export default defineConfig({
  test: {
    // Load .env.local for tests
    env: loadEnv("", process.cwd(), ""),
    // Increase timeout for integration tests that call the API
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
