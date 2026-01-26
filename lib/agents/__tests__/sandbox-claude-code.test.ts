/**
 * Sandbox Claude Code Test
 *
 * Tests running Claude Code directly inside the sandbox.
 * This uses the native `claude` CLI installed via the official installer.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Sandbox } from "@vercel/sandbox";

describe("Sandbox Claude Code", () => {
  let sandbox: Sandbox;

  beforeAll(async () => {
    // Use snapshot if available (faster), otherwise create fresh
    const snapshotId = process.env.NEXTJS_SNAPSHOT_ID;
    if (snapshotId) {
      sandbox = await Sandbox.create({
        source: { type: "snapshot", snapshotId },
        ports: [3000],
        timeout: 600_000,
        resources: { vcpus: 2 },
      });
      console.log(`Created sandbox from snapshot: ${sandbox.sandboxId}`);
    } else {
      sandbox = await Sandbox.create({
        ports: [3000],
        timeout: 600_000,
        resources: { vcpus: 2 },
      });
      console.log(`Created fresh sandbox: ${sandbox.sandboxId}`);
    }
  }, 120_000);

  afterAll(async () => {
    if (sandbox) {
      await sandbox.stop();
    }
  });

  it("should install claude code via official installer", async () => {
    console.log("Installing Claude Code...");
    
    // Install using the official installer script
    const installResult = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash"],
      cwd: "/vercel/sandbox",
    });

    const stdout = await installResult.stdout();
    const stderr = await installResult.stderr();
    console.log("Install stdout:", stdout);
    console.log("Install stderr:", stderr);
    console.log("Install exit code:", installResult.exitCode);

    // Check if claude is now available
    const whichResult = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "which claude || echo 'not found'"],
      cwd: "/vercel/sandbox",
    });
    const whichStdout = await whichResult.stdout();
    console.log("Claude location:", whichStdout.trim());

    // Also check in common install locations
    const lsResult = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "ls -la ~/.claude/local/claude 2>/dev/null || ls -la /usr/local/bin/claude 2>/dev/null || echo 'checking PATH'"],
      cwd: "/vercel/sandbox",
    });
    console.log("Claude binary:", await lsResult.stdout());

    expect(installResult.exitCode).toBe(0);
  }, 180_000);

  it("should run claude --version", async () => {
    // Source bashrc to get PATH updates, then run claude
    const result = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "source ~/.bashrc 2>/dev/null; claude --version"],
      cwd: "/vercel/sandbox",
    });

    const stdout = await result.stdout();
    const stderr = await result.stderr();
    console.log("Claude version stdout:", stdout);
    console.log("Claude version stderr:", stderr);

    expect(stdout).toMatch(/\d+\.\d+/);
  });

  it("should run claude --help", async () => {
    const result = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", "source ~/.bashrc 2>/dev/null; claude --help"],
      cwd: "/vercel/sandbox",
    });

    const stdout = await result.stdout();
    console.log("Claude help (first 500 chars):", stdout.substring(0, 500));

    expect(stdout).toContain("Claude Code");
    expect(stdout).toContain("--print");
  });

  it("should run a simple prompt with --print", async () => {
    // Skip if no API key available
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VERCEL_OIDC_TOKEN;
    if (!apiKey) {
      console.log("Skipping: No API key available");
      return;
    }

    // Build environment - use AI Gateway if we have OIDC token
    const env: Record<string, string> = {};
    if (process.env.VERCEL_OIDC_TOKEN) {
      env.ANTHROPIC_BASE_URL = "https://ai-gateway.vercel.sh";
      env.ANTHROPIC_AUTH_TOKEN = process.env.VERCEL_OIDC_TOKEN;
      env.ANTHROPIC_API_KEY = ""; // Required to be empty for gateway
    } else {
      env.ANTHROPIC_API_KEY = apiKey;
    }

    console.log("Running claude with prompt...");
    console.log("Using gateway:", !!process.env.VERCEL_OIDC_TOKEN);

    const result = await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `source ~/.bashrc 2>/dev/null; claude --print --dangerously-skip-permissions "Say hello briefly and list 3 tools you have."`,
      ],
      cwd: "/vercel/sandbox",
      env,
    });

    const stdout = await result.stdout();
    const stderr = await result.stderr();
    console.log("Claude stdout:", stdout);
    console.log("Claude stderr:", stderr);
    console.log("Exit code:", result.exitCode);

    expect(stdout.length).toBeGreaterThan(0);
    expect(result.exitCode).toBe(0);
  }, 120_000);

  it("should stream JSON output", async () => {
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

    console.log("Running claude with stream-json...");

    const result = await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `source ~/.bashrc 2>/dev/null; claude --print --verbose --output-format stream-json --dangerously-skip-permissions "What is 2+2?"`,
      ],
      cwd: "/vercel/sandbox",
      env,
    });

    const stdout = await result.stdout();
    console.log("Stream JSON (first 1500 chars):", stdout.substring(0, 1500));

    // Parse NDJSON
    const lines = stdout.trim().split("\n").filter(Boolean);
    console.log(`Got ${lines.length} JSON lines`);

    const messageTypes: string[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        messageTypes.push(`${parsed.type}${parsed.subtype ? `:${parsed.subtype}` : ""}`);
      } catch {
        // Skip non-JSON lines
      }
    }
    console.log("Message types:", messageTypes);

    expect(messageTypes).toContain("system:init");
    expect(messageTypes).toContain("result:success");
  }, 120_000);

  it("should create and edit files using native tools", async () => {
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

    console.log("Running claude to create a file...");

    const result = await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `source ~/.bashrc 2>/dev/null; claude --print --dangerously-skip-permissions "Create a file called test-file.txt containing 'Created by Claude Code!' - just do it, no explanation"`,
      ],
      cwd: "/vercel/sandbox",
      env,
    });

    const stdout = await result.stdout();
    console.log("Create file stdout:", stdout);
    console.log("Exit code:", result.exitCode);

    // Verify file was created
    const catResult = await sandbox.runCommand({
      cmd: "cat",
      args: ["test-file.txt"],
      cwd: "/vercel/sandbox",
    });
    const fileContent = await catResult.stdout();
    console.log("File content:", fileContent);

    expect(fileContent).toContain("Claude");
  }, 180_000);

  it("should edit an existing Next.js page", async () => {
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

    // First check if src/app/page.tsx exists (from snapshot)
    const checkResult = await sandbox.runCommand({
      cmd: "ls",
      args: ["-la", "src/app/page.tsx"],
      cwd: "/vercel/sandbox",
    });
    const checkStdout = await checkResult.stdout();
    console.log("Page exists check:", checkStdout);

    if (checkResult.exitCode !== 0) {
      console.log("Skipping: No Next.js page in sandbox");
      return;
    }

    console.log("Running claude to edit the page...");

    const result = await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `source ~/.bashrc 2>/dev/null; claude --print --verbose --output-format stream-json --dangerously-skip-permissions "Edit src/app/page.tsx to change the h1 text to 'Hello from Claude Code!'. Just make the edit, no explanation."`,
      ],
      cwd: "/vercel/sandbox",
      env,
    });

    const stdout = await result.stdout();
    console.log("Edit page stdout (first 2000 chars):", stdout.substring(0, 2000));

    // Parse to see what tools were used
    const lines = stdout.trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "assistant" && parsed.message?.content) {
          for (const block of parsed.message.content) {
            if (block.type === "tool_use") {
              console.log(`Tool used: ${block.name}`);
            }
          }
        }
      } catch {
        // Skip
      }
    }

    // Verify the edit
    const catResult = await sandbox.runCommand({
      cmd: "cat",
      args: ["src/app/page.tsx"],
      cwd: "/vercel/sandbox",
    });
    const pageContent = await catResult.stdout();
    console.log("Page content (first 500 chars):", pageContent.substring(0, 500));

    expect(pageContent).toContain("Claude Code");
  }, 180_000);
});
