/**
 * @fileoverview Integration tests for sandbox proxy configuration
 *
 * Verifies that the sandbox is properly configured to use the API proxy,
 * so code running in the sandbox can call the Anthropic API without secrets.
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { Sandbox } from "@vercel/sandbox";
import { sessionTokens } from "../../store/session-tokens";

describe("Sandbox Proxy Integration", () => {
  let sandbox: Sandbox;

  beforeAll(async () => {
    sandbox = await Sandbox.create({
      timeout: 60000,
    });
  }, 30000);

  afterAll(async () => {
    await sandbox.stop();
  }, 10000);

  test("should pass proxy env vars to commands", async () => {
    const proxySessionId = "test-session-123";
    const proxyBaseUrl = "http://localhost:3000/api/anthropic";

    // Run a command with proxy env vars
    const result = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "echo $ANTHROPIC_BASE_URL && echo $ANTHROPIC_API_KEY"],
      cwd: "/vercel/sandbox",
      env: {
        ANTHROPIC_BASE_URL: proxyBaseUrl,
        ANTHROPIC_API_KEY: proxySessionId,
      },
    });

    const stdout = await result.stdout();

    expect(stdout).toContain(proxyBaseUrl);
    expect(stdout).toContain(proxySessionId);
  });

  test("should write .env file with proxy config", async () => {
    const proxySessionId = "test-session-456";
    const proxyBaseUrl = "http://localhost:3000/api/anthropic";

    const envContent = [
      "# Anthropic API proxy configuration",
      `ANTHROPIC_BASE_URL=${proxyBaseUrl}`,
      `ANTHROPIC_API_KEY=${proxySessionId}`,
      "",
    ].join("\n");

    // Write .env file
    await sandbox.writeFiles([
      { path: "/vercel/sandbox/.env", content: Buffer.from(envContent, "utf-8") },
    ]);

    // Verify file was written
    const content = await sandbox.readFileToBuffer({ path: "/vercel/sandbox/.env" });
    expect(content).not.toBeNull();
    expect(content!.toString()).toContain(proxyBaseUrl);
    expect(content!.toString()).toContain(proxySessionId);
  });

  test("session token store should work correctly", () => {
    const sessionId = "test-store-session";
    const token = "real-oidc-token";

    // Set and get
    sessionTokens.set(sessionId, token);
    expect(sessionTokens.get(sessionId)).toBe(token);

    // Has
    expect(sessionTokens.has(sessionId)).toBe(true);
    expect(sessionTokens.has("nonexistent")).toBe(false);

    // Delete
    sessionTokens.delete(sessionId);
    expect(sessionTokens.get(sessionId)).toBeUndefined();
    expect(sessionTokens.has(sessionId)).toBe(false);
  });
});
