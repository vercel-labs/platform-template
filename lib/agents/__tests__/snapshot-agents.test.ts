/**
 * Snapshot AI Agents Test
 *
 * Tests that the snapshot has all AI coding agents pre-installed.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Sandbox } from "@vercel/sandbox";

describe("Snapshot AI Agents", () => {
  let sandbox: Sandbox;

  beforeAll(async () => {
    const snapshotId = process.env.NEXTJS_SNAPSHOT_ID;
    if (!snapshotId) {
      throw new Error("NEXTJS_SNAPSHOT_ID not set");
    }

    sandbox = await Sandbox.create({
      source: { type: "snapshot", snapshotId },
      ports: [3000],
      timeout: 600_000,
      resources: { vcpus: 2 },
    });
    console.log(`Created sandbox from snapshot: ${sandbox.sandboxId}`);
  }, 120_000);

  afterAll(async () => {
    if (sandbox) {
      await sandbox.stop();
    }
  });

  it("should have Claude Code pre-installed", async () => {
    const result = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "source ~/.bashrc 2>/dev/null; claude --version"],
      cwd: "/vercel/sandbox",
    });

    const stdout = await result.stdout();
    console.log("Claude version:", stdout.trim());

    expect(stdout).toMatch(/\d+\.\d+/);
    expect(stdout).toContain("Claude Code");
  });

  it("should have OpenCode pre-installed", async () => {
    const result = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "source ~/.bashrc 2>/dev/null; opencode --version"],
      cwd: "/vercel/sandbox",
    });

    const stdout = await result.stdout();
    console.log("OpenCode version:", stdout.trim());

    expect(stdout).toMatch(/\d+\.\d+/);
  });

  it("should have Codex pre-installed", async () => {
    const result = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "codex --version"],
      cwd: "/vercel/sandbox",
    });

    const stdout = await result.stdout();
    console.log("Codex version:", stdout.trim());

    expect(stdout).toMatch(/\d+\.\d+/);
  });

  it("should have Next.js project ready", async () => {
    const result = await sandbox.runCommand({
      cmd: "ls",
      args: ["-la", "src/app/page.tsx"],
      cwd: "/vercel/sandbox",
    });

    const stdout = await result.stdout();
    console.log("Page file:", stdout.trim());

    expect(result.exitCode).toBe(0);
  });

  it("should have Turbopack cache pre-built", async () => {
    const result = await sandbox.runCommand({
      cmd: "du",
      args: ["-sh", ".next/dev/cache/turbopack"],
      cwd: "/vercel/sandbox",
    });

    const stdout = await result.stdout();
    console.log("Turbopack cache size:", stdout.trim());

    expect(result.exitCode).toBe(0);
    // Cache should be at least a few MB
    expect(stdout).toMatch(/\d+[MG]/);
  });

  it("should run Claude Code with a prompt", async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VERCEL_OIDC_TOKEN;
    if (!apiKey) {
      console.log("Skipping: No API key available");
      return;
    }

    const env: Record<string, string> = {};
    if (process.env.VERCEL_OIDC_TOKEN) {
      env.ANTHROPIC_BASE_URL = "https://ai-gateway.vercel.sh";
      env.ANTHROPIC_AUTH_TOKEN = process.env.VERCEL_OIDC_TOKEN;
      env.ANTHROPIC_API_KEY = "";
    } else {
      env.ANTHROPIC_API_KEY = apiKey;
    }

    console.log("Running Claude Code with a prompt...");

    const result = await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `source ~/.bashrc 2>/dev/null; claude --print --dangerously-skip-permissions "Say hello in 5 words or less"`,
      ],
      cwd: "/vercel/sandbox",
      env,
    });

    const stdout = await result.stdout();
    console.log("Claude response:", stdout);

    expect(stdout.length).toBeGreaterThan(0);
    expect(result.exitCode).toBe(0);
  }, 60_000);
});
