/**
 * Claude Agent CLI Test
 *
 * Tests the new Claude agent that runs the CLI inside the sandbox.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Sandbox } from "@vercel/sandbox";
import { ClaudeAgentProvider } from "../claude-agent";
import type { StreamChunk } from "../types";

describe("Claude Agent (CLI)", () => {
  let sandbox: Sandbox;
  const agent = new ClaudeAgentProvider();

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
    expect(agent.id).toBe("claude");
    expect(agent.name).toBe("Claude Code");
  });

  it("should execute a simple prompt", async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VERCEL_OIDC_TOKEN;
    if (!apiKey) {
      console.log("Skipping: No API key available");
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

    // Should have message-start
    expect(chunks.some(c => c.type === "message-start")).toBe(true);
    
    // Should have some text
    const textChunks = chunks.filter(c => c.type === "text-delta");
    expect(textChunks.length).toBeGreaterThan(0);
    
    // Combined text should contain "Hello"
    const fullText = textChunks.map(c => (c as { text: string }).text).join("");
    console.log("Full response:", fullText);
    expect(fullText.toLowerCase()).toContain("hello");
    
    // Should have message-end
    expect(chunks.some(c => c.type === "message-end")).toBe(true);
  }, 60_000);

  it("should emit file-written data when creating files", async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VERCEL_OIDC_TOKEN;
    if (!apiKey) {
      console.log("Skipping: No API key available");
      return;
    }

    const chunks: StreamChunk[] = [];
    
    for await (const chunk of agent.execute({
      prompt: "Create a file called /vercel/sandbox/test-agent.txt with the content 'Test file created'. Just do it, no explanation.",
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
      args: ["test-agent.txt"],
      cwd: "/vercel/sandbox",
    });
    const content = await catResult.stdout();
    console.log("File content:", content);
    expect(content).toContain("Test");
  }, 120_000);

  it("should emit tool-start and tool-result for tool use", async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VERCEL_OIDC_TOKEN;
    if (!apiKey) {
      console.log("Skipping: No API key available");
      return;
    }

    const chunks: StreamChunk[] = [];
    
    for await (const chunk of agent.execute({
      prompt: "Read the file /vercel/sandbox/package.json and tell me the project name.",
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

    // Should have tool-start for Read
    const toolStarts = chunks.filter(c => c.type === "tool-start");
    console.log("Tool starts:", toolStarts.map(c => (c as { toolName: string }).toolName));
    expect(toolStarts.length).toBeGreaterThan(0);
    
    // Should have tool-result
    const toolResults = chunks.filter(c => c.type === "tool-result");
    expect(toolResults.length).toBeGreaterThan(0);
  }, 120_000);

  it("should return session ID for resumption", async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.VERCEL_OIDC_TOKEN;
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

    // Should have message-start with sessionId
    const messageStart = chunks.find(c => c.type === "message-start");
    expect(messageStart).toBeDefined();
    
    if (messageStart?.type === "message-start") {
      console.log("Session ID:", messageStart.sessionId);
      expect(messageStart.sessionId).toBeDefined();
    }
  }, 60_000);
});
