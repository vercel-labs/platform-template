import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { resolve } from "path";

export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 60_000,
    env: loadEnv("test", process.cwd(), ""),
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
});
