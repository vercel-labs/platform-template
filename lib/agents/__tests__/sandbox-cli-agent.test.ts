/**
 * Sandbox CLI Agent Test
 *
 * Tests running the Claude Agent SDK CLI directly inside the sandbox.
 * This approach:
 * 1. Puts the API key inside the sandbox (as env var)
 * 2. Runs the claude CLI via runCommand
 * 3. Lets the agent use its native tools (no MCP bridge needed)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Sandbox } from "@vercel/sandbox";

describe("Sandbox CLI Agent", () => {
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

  it("should have node and npm available", async () => {
    const result = await sandbox.runCommand({
      cmd: "node",
      args: ["--version"],
      cwd: "/vercel/sandbox",
    });
    const stdout = await result.stdout();
    console.log("Node version:", stdout.trim());
    expect(stdout).toMatch(/^v\d+/);
  });

  it("should install claude agent sdk", async () => {
    // Initialize npm project
    const initResult = await sandbox.runCommand({
      cmd: "npm",
      args: ["init", "-y"],
      cwd: "/vercel/sandbox",
    });
    await initResult.stdout();

    // Install the SDK
    console.log("Installing @anthropic-ai/claude-agent-sdk...");
    const installResult = await sandbox.runCommand({
      cmd: "npm",
      args: ["install", "@anthropic-ai/claude-agent-sdk"],
      cwd: "/vercel/sandbox",
    });
    const installStdout = await installResult.stdout();
    const installStderr = await installResult.stderr();
    console.log("Install stdout:", installStdout);
    console.log("Install stderr:", installStderr);
    console.log("Install exit code:", installResult.exitCode);

    // Verify it's installed
    const lsResult = await sandbox.runCommand({
      cmd: "ls",
      args: ["-la", "node_modules/@anthropic-ai/claude-agent-sdk"],
      cwd: "/vercel/sandbox",
    });
    const lsStdout = await lsResult.stdout();
    console.log("SDK directory:", lsStdout);
    expect(lsStdout).toContain("cli.js");
  }, 120_000);

  it("should run claude cli --help", async () => {
    const result = await sandbox.runCommand({
      cmd: "node",
      args: ["node_modules/@anthropic-ai/claude-agent-sdk/cli.js", "--help"],
      cwd: "/vercel/sandbox",
    });
    const stdout = await result.stdout();
    console.log("CLI help output:", stdout.substring(0, 500));
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

    console.log("Running claude CLI with prompt...");
    console.log("Using gateway:", !!process.env.VERCEL_OIDC_TOKEN);

    // Run a simple prompt
    const result = await sandbox.runCommand({
      cmd: "node",
      args: [
        "node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
        "--print",
        "--dangerously-skip-permissions",
        "Say hello and tell me what tools you have available. Be brief.",
      ],
      cwd: "/vercel/sandbox",
      env,
    });

    const stdout = await result.stdout();
    const stderr = await result.stderr();
    console.log("CLI stdout:", stdout);
    console.log("CLI stderr:", stderr);
    console.log("Exit code:", result.exitCode);

    // Should have some response
    expect(stdout.length).toBeGreaterThan(0);
  }, 120_000);

  it("should run with stream-json output format", async () => {
    // Skip if no API key available
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VERCEL_OIDC_TOKEN;
    if (!apiKey) {
      console.log("Skipping: No API key available");
      return;
    }

    // Build environment
    const env: Record<string, string> = {};
    if (process.env.VERCEL_OIDC_TOKEN) {
      env.ANTHROPIC_BASE_URL = "https://ai-gateway.vercel.sh";
      env.ANTHROPIC_AUTH_TOKEN = process.env.VERCEL_OIDC_TOKEN;
      env.ANTHROPIC_API_KEY = "";
    } else {
      env.ANTHROPIC_API_KEY = apiKey;
    }

    console.log("Running claude CLI with stream-json output...");

    // Note: stream-json requires --verbose flag
    const result = await sandbox.runCommand({
      cmd: "node",
      args: [
        "node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
        "--print",
        "--verbose",
        "--output-format", "stream-json",
        "--dangerously-skip-permissions",
        "What is 2+2? Just answer with the number.",
      ],
      cwd: "/vercel/sandbox",
      env,
    });

    const stdout = await result.stdout();
    const stderr = await result.stderr();
    console.log("Stream JSON stdout (first 2000 chars):", stdout.substring(0, 2000));
    console.log("Stream JSON stderr (first 500 chars):", stderr.substring(0, 500));

    // Parse the NDJSON lines
    const lines = stdout.trim().split("\n").filter(Boolean);
    console.log(`Got ${lines.length} JSON lines`);

    for (const line of lines.slice(0, 10)) {
      try {
        const parsed = JSON.parse(line);
        console.log("Parsed message type:", parsed.type, parsed.subtype || "");
      } catch (e) {
        console.log("Non-JSON line:", line.substring(0, 100));
      }
    }

    expect(lines.length).toBeGreaterThan(0);
  }, 120_000);

  it("should create a file using native tools", async () => {
    // Skip if no API key available
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VERCEL_OIDC_TOKEN;
    if (!apiKey) {
      console.log("Skipping: No API key available");
      return;
    }

    // Build environment
    const env: Record<string, string> = {};
    if (process.env.VERCEL_OIDC_TOKEN) {
      env.ANTHROPIC_BASE_URL = "https://ai-gateway.vercel.sh";
      env.ANTHROPIC_AUTH_TOKEN = process.env.VERCEL_OIDC_TOKEN;
      env.ANTHROPIC_API_KEY = "";
    } else {
      env.ANTHROPIC_API_KEY = apiKey;
    }

    console.log("Running claude CLI to create a file...");

    // Use plain --print mode (not stream-json) for simpler output
    const result = await sandbox.runCommand({
      cmd: "node",
      args: [
        "node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
        "--print",
        "--dangerously-skip-permissions",
        "Create a file called hello.txt with the content 'Hello from Claude!' in the current directory. Just create the file, no explanation needed.",
      ],
      cwd: "/vercel/sandbox",
      env,
    });

    const stdout = await result.stdout();
    const stderr = await result.stderr();
    console.log("Create file stdout:", stdout);
    console.log("Create file stderr:", stderr);
    console.log("Exit code:", result.exitCode);

    // Check if the file was created
    const checkResult = await sandbox.runCommand({
      cmd: "cat",
      args: ["hello.txt"],
      cwd: "/vercel/sandbox",
    });
    const fileContent = await checkResult.stdout();
    console.log("File content:", fileContent);

    expect(fileContent).toContain("Hello");
  }, 180_000);
});
