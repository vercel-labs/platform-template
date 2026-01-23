/**
 * Claude Agent Provider Integration Tests
 *
 * Run with: pnpm vitest run lib/agents/__tests__/claude-agent.integration.test.ts
 */

import { test, expect, describe, beforeAll, afterAll } from "vitest";
import { Sandbox } from "@vercel/sandbox";
import { ClaudeAgentProvider } from "../claude-agent";
import { createAgentStream } from "../stream";
import type { StreamChunk, SandboxContext } from "../types";

// Helper to collect all chunks from the async iterable
async function collectChunks(
  iterable: AsyncIterable<StreamChunk>
): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}

// Helper to find specific chunk types
function findChunks<T extends StreamChunk["type"]>(
  chunks: StreamChunk[],
  type: T
): Extract<StreamChunk, { type: T }>[] {
  return chunks.filter((c): c is Extract<StreamChunk, { type: T }> => c.type === type);
}

// Use Haiku for tests to minimize cost
const TEST_MODEL = "haiku";

describe("ClaudeAgentProvider Integration", () => {
  let provider: ClaudeAgentProvider;
  let sandbox: Sandbox;
  let sandboxContext: SandboxContext;

  beforeAll(async () => {
    provider = new ClaudeAgentProvider();

    console.log("Creating sandbox...");
    sandbox = await Sandbox.create({
      ports: [3000, 5173],
      timeout: 300_000,
    });
    console.log(`Sandbox created: ${sandbox.sandboxId}`);

    sandboxContext = {
      sandboxId: sandbox.sandboxId,
      sandbox,
    };
  }, 60_000);

  afterAll(async () => {
    if (sandbox) {
      console.log("Stopping sandbox...");
      await sandbox.stop();
    }
  });

  describe("basic execution", () => {
    test("should respond to a simple prompt", async () => {
      const chunks = await collectChunks(
        provider.execute({
          prompt: "Say hello in exactly 3 words.",
          sandboxContext,
          model: TEST_MODEL,
        })
      );

      const textDeltas = findChunks(chunks, "text-delta");
      expect(textDeltas.length).toBeGreaterThan(0);

      const fullText = textDeltas.map((c) => c.text).join("");
      console.log("Response:", fullText);

      const messageEnds = findChunks(chunks, "message-end");
      expect(messageEnds.length).toBe(1);

      // Should have usage info
      const usage = messageEnds[0].usage;
      expect(usage).toBeDefined();
      expect(usage?.inputTokens).toBeGreaterThan(0);
      expect(usage?.outputTokens).toBeGreaterThan(0);
    }, 60_000);

    test("should convert to AI SDK stream format", async () => {
      const agentOutput = provider.execute({
        prompt: "What is 2 + 2? Answer with just the number.",
        sandboxContext,
        model: TEST_MODEL,
      });

      const stream = createAgentStream(agentOutput);
      const reader = stream.getReader();
      const uiChunks: unknown[] = [];
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        uiChunks.push(value);
      }

      // Should have text-start, text-delta(s), text-end
      const types = uiChunks.map((c: any) => c.type);
      expect(types).toContain("text-start");
      expect(types).toContain("text-delta");
      expect(types).toContain("text-end");
    }, 60_000);
  });

  describe("tool usage", () => {
    test("should write a file to the sandbox", async () => {
      const chunks = await collectChunks(
        provider.execute({
          prompt:
            "Write a file at /vercel/sandbox/test.txt with the content 'Hello from test'. Use the Write tool.",
          sandboxContext,
          model: TEST_MODEL,
        })
      );

      // Should have tool-start chunks (MCP tools are prefixed with mcp__sandbox__)
      const toolStarts = findChunks(chunks, "tool-start");
      expect(toolStarts.length).toBeGreaterThan(0);

      // Should have used Write tool (with mcp__sandbox__ prefix)
      const writeFileTool = toolStarts.find((c) => c.toolName.includes("Write"));
      expect(writeFileTool).toBeDefined();

      // Should have tool-result
      const toolResults = findChunks(chunks, "tool-result");
      expect(toolResults.length).toBeGreaterThan(0);

      // Tool result should indicate success
      const writeResult = toolResults.find((r) =>
        r.output.includes("Wrote") || r.output.includes("bytes")
      );
      expect(writeResult).toBeDefined();

      // Verify the file was written by reading it directly from sandbox
      const fileStream = await sandbox.readFile({ path: "/vercel/sandbox/test.txt" });
      if (!fileStream) {
        throw new Error("File not found after write");
      }
      const fileChunks: Uint8Array[] = [];
      for await (const chunk of fileStream) {
        if (chunk instanceof Uint8Array) {
          fileChunks.push(chunk);
        } else if (Buffer.isBuffer(chunk)) {
          fileChunks.push(new Uint8Array(chunk));
        } else if (typeof chunk === "string") {
          fileChunks.push(new TextEncoder().encode(chunk));
        }
      }
      const fileContent = new TextDecoder().decode(
        fileChunks.length === 1 ? fileChunks[0] : Buffer.concat(fileChunks)
      );
      expect(fileContent.trim()).toBe("Hello from test");
    }, 120_000);

    test("should read a file from the sandbox", async () => {
      // First, create a file
      await sandbox.writeFiles([
        {
          path: "/vercel/sandbox/read-test.txt",
          content: Buffer.from("Content to read", "utf-8"),
        },
      ]);

      const chunks = await collectChunks(
        provider.execute({
          prompt:
            "Read the file at /vercel/sandbox/read-test.txt and tell me what it contains.",
          sandboxContext,
          model: TEST_MODEL,
        })
      );

      // Should have used Read tool
      const toolStarts = findChunks(chunks, "tool-start");
      const readFileTool = toolStarts.find((c) => c.toolName.includes("Read"));
      expect(readFileTool).toBeDefined();

      // Should have tool result with file content
      const toolResults = findChunks(chunks, "tool-result");
      const readResult = toolResults.find((r) => r.output.includes("Content to read"));
      expect(readResult).toBeDefined();

      // The response should mention the file content
      const textDeltas = findChunks(chunks, "text-delta");
      const fullText = textDeltas.map((c) => c.text).join("");
      console.log("Response after reading file:", fullText);
    }, 120_000);

    test("should run a command in the sandbox", async () => {
      const chunks = await collectChunks(
        provider.execute({
          prompt: "Run the command 'echo Hello World' in the sandbox.",
          sandboxContext,
          model: TEST_MODEL,
        })
      );

      // Should have used Bash tool
      const toolStarts = findChunks(chunks, "tool-start");
      const bashTool = toolStarts.find((c) => c.toolName.includes("Bash"));
      expect(bashTool).toBeDefined();

      // Should have tool result with command output
      const toolResults = findChunks(chunks, "tool-result");
      expect(toolResults.length).toBeGreaterThan(0);

      // Result should contain the echo output
      const cmdResult = toolResults.find(
        (r) => r.output.includes("Hello World") || r.output.includes("stdout")
      );
      expect(cmdResult).toBeDefined();
    }, 120_000);
  });

  describe("abort handling", () => {
    test("should stop gracefully when aborted", async () => {
      const abortController = new AbortController();
      const chunks: StreamChunk[] = [];

      const promise = (async () => {
        for await (const chunk of provider.execute({
          prompt: "Write a very long story about a cat. Make it at least 1000 words.",
          sandboxContext,
          signal: abortController.signal,
          model: TEST_MODEL,
        })) {
          chunks.push(chunk);
          // Abort after receiving some chunks
          if (chunks.length > 5) {
            abortController.abort();
            break;
          }
        }
      })();

      await promise;

      // Should have received some chunks before aborting
      expect(chunks.length).toBeGreaterThan(0);

      // Should NOT have an error chunk (graceful abort)
      const errors = findChunks(chunks, "error");
      expect(errors.length).toBe(0);
    }, 60_000);
  });

  describe("error handling", () => {
    test("should handle invalid path errors from tools", async () => {
      const chunks = await collectChunks(
        provider.execute({
          prompt:
            "Try to read the file at /etc/passwd using the read_file tool.",
          sandboxContext,
          model: TEST_MODEL,
        })
      );

      // The agent should try to use the tool and get an error
      const toolResults = findChunks(chunks, "tool-result");
      
      // Either tool returns an error or agent explains it can't
      const hasToolError = toolResults.some(
        (r) => r.isError || r.output.toLowerCase().includes("error")
      );
      const textMentionsError = findChunks(chunks, "text-delta").some((t) =>
        t.text.toLowerCase().includes("error") ||
        t.text.toLowerCase().includes("outside") ||
        t.text.toLowerCase().includes("cannot")
      );

      expect(hasToolError || textMentionsError).toBe(true);
    }, 120_000);
  });
});

describe("ClaudeAgentProvider Unit Tests", () => {
  test("provider has correct metadata", () => {
    const provider = new ClaudeAgentProvider();
    expect(provider.id).toBe("claude-agent");
    expect(provider.name).toBe("Claude Agent");
    expect(provider.description).toBeDefined();
  });
});
