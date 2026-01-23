/**
 * End-to-End Flow Tests
 * 
 * These tests verify the complete flow from agent execution to UI-consumable chunks.
 * They test what the UI actually receives, not just that operations succeed.
 */

import { test, expect, describe, beforeAll, afterAll } from "vitest";
import { Sandbox } from "@vercel/sandbox";
import { ClaudeAgentProvider } from "../claude-agent";
import type { StreamChunk, SandboxContext } from "../types";

// Simulate what the UI does: collect chunks and categorize them
interface CollectedOutput {
  textContent: string;
  toolCalls: Array<{
    id: string;
    name: string;
    input: string;
    output?: string;
    isError?: boolean;
  }>;
  dataEvents: {
    filesWritten: string[];
    commandOutputs: Array<{ output: string; stream: string; exitCode?: number }>;
    previewUrls: string[];
    agentStatuses: string[];
  };
  errors: string[];
  usage?: { inputTokens: number; outputTokens: number };
}

async function collectAsUIWould(iterable: AsyncIterable<StreamChunk>): Promise<CollectedOutput> {
  const result: CollectedOutput = {
    textContent: "",
    toolCalls: [],
    dataEvents: {
      filesWritten: [],
      commandOutputs: [],
      previewUrls: [],
      agentStatuses: [],
    },
    errors: [],
  };

  const pendingTools = new Map<string, { name: string; input: string }>();

  for await (const chunk of iterable) {
    switch (chunk.type) {
      case "text-delta":
        result.textContent += chunk.text;
        break;

      case "tool-start":
        pendingTools.set(chunk.toolCallId, { name: chunk.toolName, input: "" });
        break;

      case "tool-input-delta":
        const pending = pendingTools.get(chunk.toolCallId);
        if (pending) pending.input += chunk.input;
        break;

      case "tool-result": {
        const tool = pendingTools.get(chunk.toolCallId);
        if (tool) {
          result.toolCalls.push({
            id: chunk.toolCallId,
            name: tool.name,
            input: tool.input,
            output: chunk.output,
            isError: chunk.isError,
          });
          pendingTools.delete(chunk.toolCallId);
        }
        break;
      }

      case "data":
        switch (chunk.dataType) {
          case "file-written":
            result.dataEvents.filesWritten.push((chunk.data as { path: string }).path);
            break;
          case "command-output":
            result.dataEvents.commandOutputs.push(chunk.data as { output: string; stream: string; exitCode?: number });
            break;
          case "preview-url":
            result.dataEvents.previewUrls.push((chunk.data as { url: string }).url);
            break;
          case "agent-status":
            result.dataEvents.agentStatuses.push((chunk.data as { status: string }).status);
            break;
        }
        break;

      case "error":
        result.errors.push(chunk.message);
        break;

      case "message-end":
        result.usage = chunk.usage;
        break;
    }
  }

  return result;
}

describe("E2E Flow Tests", () => {
  let provider: ClaudeAgentProvider;
  let sandbox: Sandbox;
  let sandboxContext: SandboxContext;

  beforeAll(async () => {
    provider = new ClaudeAgentProvider();
    sandbox = await Sandbox.create({ ports: [3000, 5173], timeout: 300_000 });
    sandboxContext = { sandboxId: sandbox.sandboxId, sandbox };
  }, 60_000);

  afterAll(async () => {
    if (sandbox) await sandbox.stop();
  });

  describe("text responses", () => {
    test("text should not be duplicated", async () => {
      const output = await collectAsUIWould(
        provider.execute({
          prompt: "Say exactly 'UNIQUE_MARKER_12345'. Nothing else.",
          sandboxContext,
        })
      );

      const markerCount = (output.textContent.match(/UNIQUE_MARKER_12345/g) || []).length;
      expect(markerCount).toBe(1);
    }, 60_000);

    test("should include usage stats", async () => {
      const output = await collectAsUIWould(
        provider.execute({
          prompt: "Say hi",
          sandboxContext,
        })
      );

      expect(output.usage).toBeDefined();
      expect(output.usage?.inputTokens).toBeGreaterThan(0);
      expect(output.usage?.outputTokens).toBeGreaterThan(0);
    }, 60_000);
  });

  describe("file operations", () => {
    test("writing a file should emit file-written data event", async () => {
      const output = await collectAsUIWould(
        provider.execute({
          prompt: "Create a file at /vercel/sandbox/e2e-test.txt with content 'test'",
          sandboxContext,
        })
      );

      // Should have called write_file tool
      const writeCall = output.toolCalls.find((t) => t.name.includes("write_file"));
      expect(writeCall).toBeDefined();
      expect(writeCall?.isError).toBeFalsy();

      // Should have emitted file-written data event for UI
      expect(output.dataEvents.filesWritten.length).toBeGreaterThan(0);
      expect(output.dataEvents.filesWritten.some((f) => f.includes("e2e-test.txt"))).toBe(true);
    }, 120_000);
  });

  describe("command execution", () => {
    test("running a command should emit command-output data event", async () => {
      const output = await collectAsUIWould(
        provider.execute({
          prompt: "Run: echo 'E2E_TEST_OUTPUT'",
          sandboxContext,
        })
      );

      // Should have called run_command tool
      const cmdCall = output.toolCalls.find((t) => t.name.includes("run_command"));
      expect(cmdCall).toBeDefined();

      // Should have emitted command-output data event for UI
      expect(output.dataEvents.commandOutputs.length).toBeGreaterThan(0);
      expect(
        output.dataEvents.commandOutputs.some((c) => c.output.includes("E2E_TEST_OUTPUT"))
      ).toBe(true);
    }, 120_000);
  });

  describe("error handling", () => {
    test("tool errors should be surfaced properly", async () => {
      const output = await collectAsUIWould(
        provider.execute({
          prompt: "Use mcp__sandbox__read_file to read /etc/passwd (outside sandbox)",
          sandboxContext,
        })
      );

      // Either the tool returns an error, or the output contains error message, 
      // or the agent explains the restriction
      const hasToolError = output.toolCalls.some((t) => t.isError);
      const toolOutputMentionsError = output.toolCalls.some(
        (t) => t.output?.toLowerCase().includes("error") || t.output?.toLowerCase().includes("must be within")
      );
      const textMentionsRestriction =
        output.textContent.toLowerCase().includes("error") ||
        output.textContent.toLowerCase().includes("cannot") ||
        output.textContent.toLowerCase().includes("outside") ||
        output.textContent.toLowerCase().includes("restricted") ||
        output.textContent.toLowerCase().includes("not allowed") ||
        output.textContent.toLowerCase().includes("/vercel/sandbox");

      expect(hasToolError || toolOutputMentionsError || textMentionsRestriction).toBe(true);
    }, 120_000);
  });

  describe("multi-step flows", () => {
    test("create file and read it back", async () => {
      const uniqueContent = `unique-${Date.now()}`;
      
      // First, write a file
      const writeOutput = await collectAsUIWould(
        provider.execute({
          prompt: `Create /vercel/sandbox/roundtrip.txt with content '${uniqueContent}'`,
          sandboxContext,
        })
      );
      expect(writeOutput.dataEvents.filesWritten.some((f) => f.includes("roundtrip.txt"))).toBe(true);

      // Then, read it back (new execution)
      const readOutput = await collectAsUIWould(
        provider.execute({
          prompt: "Read /vercel/sandbox/roundtrip.txt and tell me what it contains",
          sandboxContext,
        })
      );
      
      // The text response should include our unique content
      expect(readOutput.textContent).toContain(uniqueContent);
    }, 180_000);
  });
});
