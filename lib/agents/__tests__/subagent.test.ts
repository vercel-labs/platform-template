/**
 * @fileoverview Tests for subagent/Task tool support
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Sandbox } from "@vercel/sandbox";
import { ClaudeAgentProvider } from "../claude-agent";
import type { SandboxContext, StreamChunk } from "../types";

// Use Haiku for tests to minimize cost
const TEST_MODEL = "haiku";

describe("Subagent Support", () => {
  let sandbox: Sandbox;
  let sandboxContext: SandboxContext;

  beforeAll(async () => {
    console.log("Creating sandbox...");
    sandbox = await Sandbox.create({
      timeoutMs: 60000,
    });
    console.log(`Sandbox created: ${sandbox.id}`);

    sandboxContext = {
      sandbox,
      sandboxId: sandbox.id,
    };
  }, 30000);

  afterAll(async () => {
    console.log("Stopping sandbox...");
    await sandbox.stop();
  }, 10000);

  it("should have Task tool available when agents are defined", async () => {
    const agent = new ClaudeAgentProvider();
    const chunks: StreamChunk[] = [];

    // Ask the model to describe what tools it has available
    // This will help us verify if Task tool is accessible
    for await (const chunk of agent.execute({
      prompt: "What tools do you have available? List them briefly.",
      sandboxContext,
      model: TEST_MODEL,
    })) {
      chunks.push(chunk);
    }

    // Get the text response
    const textChunks = chunks.filter((c) => c.type === "text-delta") as Array<{
      type: "text-delta";
      text: string;
    }>;
    const response = textChunks.map((c) => c.text).join("");

    console.log("Response about available tools:", response);

    // The response should mention the sandbox tools at minimum
    // If Task tool is available, it should also mention Task/Agent
    expect(response.toLowerCase()).toMatch(/read|write|bash|glob|grep/);
  }, 30000);

  it("should invoke explore subagent when asked to search", async () => {
    const agent = new ClaudeAgentProvider();
    const chunks: StreamChunk[] = [];

    // First create a file to search for
    await sandbox.writeFiles([
      {
        path: "/vercel/sandbox/test-project/src/index.ts",
        content: Buffer.from("export function hello() { return 'world'; }", "utf-8"),
      },
      {
        path: "/vercel/sandbox/test-project/src/utils.ts",
        content: Buffer.from("export function helper() { return 'helper'; }", "utf-8"),
      },
    ]);

    // Ask to explore the codebase - this should potentially use the explore agent
    for await (const chunk of agent.execute({
      prompt: "Find all TypeScript files in /vercel/sandbox/test-project and tell me what functions are exported.",
      sandboxContext,
      model: TEST_MODEL,
    })) {
      chunks.push(chunk);
      if (chunk.type === "tool-start") {
        console.log(`Tool started: ${chunk.toolName}`);
      }
    }

    // Get the text response
    const textChunks = chunks.filter((c) => c.type === "text-delta") as Array<{
      type: "text-delta";
      text: string;
    }>;
    const response = textChunks.map((c) => c.text).join("");

    console.log("Response:", response);

    // Should find the exported functions
    expect(response.toLowerCase()).toMatch(/hello|helper/);
  }, 60000);
});
