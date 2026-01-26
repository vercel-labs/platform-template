import { defineConfig } from "vitest/config";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// Load .env.local manually before vitest runs
const envLocalPath = resolve(process.cwd(), ".env.local");
if (existsSync(envLocalPath)) {
  const envContent = readFileSync(envLocalPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...valueParts] = trimmed.split("=");
      if (key && valueParts.length > 0) {
        const value = valueParts.join("=").trim();
        // Only set if not already set (don't override shell env)
        if (process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
    }
  }
}

export default defineConfig({
  test: {
    // Increase timeout for integration tests that call the API
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
