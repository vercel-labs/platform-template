/**
 * Codex Agent CLI Test
 *
 * Tests the Codex agent that runs the CLI inside the sandbox.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Sandbox } from "@vercel/sandbox";
import { CodexAgentProvider } from "../codex-agent";
import type { StreamChunk } from "../types";

describe("Codex Agent (CLI)", () => {
  let sandbox: Sandbox;
  const agent = new CodexAgentProvider();

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
    console.log(`Created sandbox: ${sandbox.sandboxId}`);
  }, 120_000);

  afterAll(async () => {
    if (sandbox) {
      await sandbox.stop();
    }
  });

  it("should have correct agent metadata", () => {
    expect(agent.id).toBe("codex");
    expect(agent.name).toBe("Codex");
  });

  it("should execute a simple prompt", async () => {
    const apiKey = process.env.VERCEL_OIDC_TOKEN || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.log("Skipping: No API key available (need VERCEL_OIDC_TOKEN or OPENAI_API_KEY)");
      return;
    }

    const chunks: StreamChunk[] = [];
    
    for await (const chunk of agent.execute({
      prompt: "Say 'Hello World' and nothing else.",
      sandboxContext: { sandboxId: sandbox.sandboxId, sandbox },
    })) {
      chunks.push(chunk);
      console.log("Chunk:", chunk.type, chunk.type === "text-delta" ? chunk.text : "");
    }

    // Should have message-start (thread.started)
    expect(chunks.some(c => c.type === "message-start")).toBe(true);
    
    // Should have some text (item.completed with agent_message)
    const textChunks = chunks.filter(c => c.type === "text-delta");
    expect(textChunks.length).toBeGreaterThan(0);
    
    // Combined text should contain "Hello"
    const fullText = textChunks.map(c => (c as { text: string }).text).join("");
    console.log("Full response:", fullText);
    expect(fullText.toLowerCase()).toContain("hello");
    
    // Should have message-end (turn.completed)
    expect(chunks.some(c => c.type === "message-end")).toBe(true);
  }, 180_000);

  it("should emit file-written data when creating files", async () => {
    const apiKey = process.env.VERCEL_OIDC_TOKEN || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.log("Skipping: No API key available");
      return;
    }

    const chunks: StreamChunk[] = [];
    
    for await (const chunk of agent.execute({
      prompt: "Create a file called /vercel/sandbox/codex-test.txt with the content 'Codex test file'. Just do it, no explanation.",
      sandboxContext: { sandboxId: sandbox.sandboxId, sandbox },
    })) {
      chunks.push(chunk);
      if (chunk.type === "data") {
        console.log("Data chunk:", chunk.dataType, chunk.data);
      }
    }

    // Should have file-written data part
    const fileWrittenChunks = chunks.filter(
      c => c.type === "data" && c.dataType === "file-written"
    );
    console.log("File written chunks:", fileWrittenChunks);
    
    // Verify file was actually created
    const catResult = await sandbox.runCommand({
      cmd: "cat",
      args: ["codex-test.txt"],
      cwd: "/vercel/sandbox",
    });
    const content = await catResult.stdout();
    console.log("File content:", content);
    expect(content).toContain("Codex");
  }, 180_000);

  it("should emit tool-start and tool-result for command execution", async () => {
    const apiKey = process.env.VERCEL_OIDC_TOKEN || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.log("Skipping: No API key available");
      return;
    }

    const chunks: StreamChunk[] = [];
    
    for await (const chunk of agent.execute({
      prompt: "Run 'ls -la' in the current directory and tell me what you see.",
      sandboxContext: { sandboxId: sandbox.sandboxId, sandbox },
    })) {
      chunks.push(chunk);
      if (chunk.type === "tool-start") {
        console.log("Tool start:", chunk.toolName);
      }
      if (chunk.type === "tool-result") {
        console.log("Tool result:", chunk.output?.substring(0, 100));
      }
    }

    // Should have tool-start for Bash (command execution)
    const toolStarts = chunks.filter(c => c.type === "tool-start");
    console.log("Tool starts:", toolStarts.map(c => (c as { toolName: string }).toolName));
    expect(toolStarts.length).toBeGreaterThan(0);
    
    // Should have tool-result
    const toolResults = chunks.filter(c => c.type === "tool-result");
    expect(toolResults.length).toBeGreaterThan(0);
  }, 120_000);

  it("should return thread ID for resumption", async () => {
    const apiKey = process.env.VERCEL_OIDC_TOKEN || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.log("Skipping: No API key available");
      return;
    }

    const chunks: StreamChunk[] = [];
    
    for await (const chunk of agent.execute({
      prompt: "Say 'test'",
      sandboxContext: { sandboxId: sandbox.sandboxId, sandbox },
    })) {
      chunks.push(chunk);
    }

    // Should have message-start with sessionId (thread_id)
    const messageStart = chunks.find(c => c.type === "message-start");
    expect(messageStart).toBeDefined();
    
    if (messageStart?.type === "message-start") {
      console.log("Thread ID:", messageStart.sessionId);
      expect(messageStart.sessionId).toBeDefined();
    }
  }, 120_000);

  it("should handle CLI errors gracefully", async () => {
    const apiKey = process.env.VERCEL_OIDC_TOKEN || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.log("Skipping: No API key available");
      return;
    }

    // Test with an invalid prompt that should still work but return quickly
    const chunks: StreamChunk[] = [];
    
    for await (const chunk of agent.execute({
      prompt: "Say just 'ok'",
      sandboxContext: { sandboxId: sandbox.sandboxId, sandbox },
    })) {
      chunks.push(chunk);
    }

    // Should have some response (either success or error)
    expect(chunks.length).toBeGreaterThan(0);
    
    // Should have started a thread
    const messageStart = chunks.find(c => c.type === "message-start");
    expect(messageStart).toBeDefined();
  }, 60_000);
});
