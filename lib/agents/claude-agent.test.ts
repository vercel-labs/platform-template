import { test, expect, describe, beforeAll, afterAll } from "vitest";
import { Sandbox } from "@vercel/sandbox";
import { ClaudeAgentProvider } from "./claude-agent";
import type { StreamChunk, SandboxContext, ProxyConfig } from "./types";

/**
 * Access private method for testing via any cast
 */
function convertToStreamChunks(
  provider: ClaudeAgentProvider,
  message: unknown
): StreamChunk[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (provider as any).convertToStreamChunks(message);
}

/**
 * Simulates processing Claude CLI stream-json output.
 * Each line is a complete JSON message.
 * Returns chunks with timestamps to verify streaming behavior.
 */
async function* simulateClaudeStream(
  lines: string[],
  delayBetweenLines: number = 0
): AsyncGenerator<{ chunk: StreamChunk; timestamp: number }> {
  const provider = new ClaudeAgentProvider();
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    const message = JSON.parse(line);
    const chunks = convertToStreamChunks(provider, message);
    const timestamp = Date.now();
    
    for (const chunk of chunks) {
      yield { chunk, timestamp };
    }
    
    if (delayBetweenLines > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayBetweenLines));
    }
  }
}

describe("Claude Agent Streaming", () => {
  describe("convertToStreamChunks", () => {
    test("should emit tool-start immediately for Write tool", () => {
      const provider = new ClaudeAgentProvider();

      // Simulate Claude CLI output for a Write tool call
      const assistantMessage = {
        type: "assistant",
        message: {
          id: "msg_123",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool_123",
              name: "Write",
              input: {
                file_path: "/vercel/sandbox/src/app/page.tsx",
                content:
                  "export default function Page() { return <div>Hello</div> }",
              },
            },
          ],
          model: "claude-sonnet-4-20250514",
        },
        session_id: "session_123",
        uuid: "uuid_123",
      };

      const chunks = convertToStreamChunks(provider, assistantMessage);

      // Should have tool-start
      const toolStart = chunks.find(
        (c): c is Extract<StreamChunk, { type: "tool-start" }> =>
          c.type === "tool-start"
      );
      expect(toolStart).toBeDefined();
      expect(toolStart).toMatchObject({
        type: "tool-start",
        toolCallId: "tool_123",
        toolName: "Write",
      });

      // Should have FILE_WRITTEN data
      const fileWritten = chunks.find(
        (c): c is Extract<StreamChunk, { type: "data" }> =>
          c.type === "data" && c.dataType === "file-written"
      );
      expect(fileWritten).toBeDefined();
    });

    test("should emit tool-input-delta with file content for Write tool", () => {
      const provider = new ClaudeAgentProvider();

      const assistantMessage = {
        type: "assistant",
        message: {
          id: "msg_123",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool_123",
              name: "Write",
              input: {
                file_path: "/vercel/sandbox/src/app/page.tsx",
                content:
                  "export default function Page() { return <div>Hello</div> }",
              },
            },
          ],
          model: "claude-sonnet-4-20250514",
        },
        session_id: "session_123",
        uuid: "uuid_123",
      };

      const chunks = convertToStreamChunks(provider, assistantMessage);

      const toolInputDelta = chunks.find(
        (c): c is Extract<StreamChunk, { type: "tool-input-delta" }> =>
          c.type === "tool-input-delta"
      );

      expect(toolInputDelta).toBeDefined();
      expect(toolInputDelta).toMatchObject({
        type: "tool-input-delta",
        toolCallId: "tool_123",
      });

      // Verify the input contains the file content
      const input = JSON.parse(toolInputDelta!.input);
      expect(input.file_path).toBe("/vercel/sandbox/src/app/page.tsx");
      expect(input.content).toContain("Hello");
    });

    test("should emit tool-input-delta with command for Bash tool", () => {
      const provider = new ClaudeAgentProvider();

      const assistantMessage = {
        type: "assistant",
        message: {
          id: "msg_123",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool_123",
              name: "Bash",
              input: {
                command: "ls -la /vercel/sandbox",
              },
            },
          ],
          model: "claude-sonnet-4-20250514",
        },
        session_id: "session_123",
        uuid: "uuid_123",
      };

      const chunks = convertToStreamChunks(provider, assistantMessage);

      const toolInputDelta = chunks.find(
        (c): c is Extract<StreamChunk, { type: "tool-input-delta" }> =>
          c.type === "tool-input-delta"
      );

      expect(toolInputDelta).toBeDefined();

      const input = JSON.parse(toolInputDelta!.input);
      expect(input.command).toBe("ls -la /vercel/sandbox");
    });

    test("stream order should be: tool-start -> tool-input-delta -> data", () => {
      const provider = new ClaudeAgentProvider();

      const assistantMessage = {
        type: "assistant",
        message: {
          id: "msg_123",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool_123",
              name: "Write",
              input: {
                file_path: "/vercel/sandbox/test.txt",
                content: "Hello World",
              },
            },
          ],
          model: "claude-sonnet-4-20250514",
        },
        session_id: "session_123",
        uuid: "uuid_123",
      };

      const chunks = convertToStreamChunks(provider, assistantMessage);
      const types = chunks.map((c) => c.type);

      // Expected order for good UX:
      // 1. tool-start (UI shows "Write tool started")
      // 2. tool-input-delta (UI shows the file path and content being written)
      // 3. data (FILE_WRITTEN event)

      const toolStartIdx = types.indexOf("tool-start");
      const toolInputIdx = types.indexOf("tool-input-delta");
      const dataIdx = types.indexOf("data");

      expect(toolStartIdx).toBeGreaterThanOrEqual(0);
      expect(toolInputIdx).toBeGreaterThan(toolStartIdx);
      expect(dataIdx).toBeGreaterThan(toolInputIdx);
    });
  });

  describe("streaming behavior", () => {
    /**
     * This test reproduces the UI hanging issue.
     * 
     * The problem: Claude CLI outputs complete JSON lines. When Claude executes
     * a tool, the sequence is:
     * 1. assistant message with tool_use (we emit tool-start + tool-input-delta)
     * 2. Claude executes the tool internally
     * 3. user message with tool_result (we emit tool-result)
     * 
     * Without --include-partial-messages, the CLI buffers until each message
     * is complete, so steps 1 and 3 arrive with no gap for UI to render.
     */
    test("tool-start and tool-result arrive from different JSON lines", async () => {
      // Simulate Claude CLI output - these are separate JSON lines
      const assistantLine = JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool_123",
              name: "Write",
              input: {
                file_path: "/vercel/sandbox/src/app/page.tsx",
                content: "export default function Page() { return <div>Hello</div> }",
              },
            },
          ],
          model: "claude-sonnet-4-20250514",
        },
        session_id: "session_123",
        uuid: "uuid_123",
      });

      const userLine = JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_123",
              content: "File written successfully",
            },
          ],
        },
      });

      // Collect all chunks with their timestamps
      const results: { chunk: StreamChunk; timestamp: number }[] = [];
      
      // No delay - simulates the bug where lines arrive together
      for await (const result of simulateClaudeStream([assistantLine, userLine], 0)) {
        results.push(result);
      }

      // Find the relevant chunks
      const toolStart = results.find((r) => r.chunk.type === "tool-start");
      const toolInputDelta = results.find((r) => r.chunk.type === "tool-input-delta");
      const toolResult = results.find((r) => r.chunk.type === "tool-result");

      expect(toolStart).toBeDefined();
      expect(toolInputDelta).toBeDefined();
      expect(toolResult).toBeDefined();

      // BUG REPRODUCTION: Chunks arrive within milliseconds of each other
      // because both JSON lines are processed in the same event loop tick.
      // This means the UI sees tool-start and tool-result nearly simultaneously,
      // with no time for the user to see the "Running..." state.
      const timeDiff = Math.abs(toolResult!.timestamp - toolStart!.timestamp);
      expect(timeDiff).toBeLessThan(10); // Less than 10ms apart = effectively simultaneous
    });

    test("with delay between lines, tool-start arrives before tool-result", async () => {
      const assistantLine = JSON.stringify({
        type: "assistant",
        message: {
          id: "msg_123",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool_123",
              name: "Write",
              input: {
                file_path: "/vercel/sandbox/src/app/page.tsx",
                content: "export default function Page() { return <div>Hello</div> }",
              },
            },
          ],
          model: "claude-sonnet-4-20250514",
        },
        session_id: "session_123",
        uuid: "uuid_123",
      });

      const userLine = JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_123",
              content: "File written successfully",
            },
          ],
        },
      });

      const results: { chunk: StreamChunk; timestamp: number }[] = [];
      
      // 50ms delay between lines - simulates proper streaming
      for await (const result of simulateClaudeStream([assistantLine, userLine], 50)) {
        results.push(result);
      }

      const toolStart = results.find((r) => r.chunk.type === "tool-start");
      const toolResult = results.find((r) => r.chunk.type === "tool-result");

      expect(toolStart).toBeDefined();
      expect(toolResult).toBeDefined();

      // With delay, tool-start arrives before tool-result
      // This gives the UI time to render the "Running..." state
      expect(toolResult!.timestamp).toBeGreaterThan(toolStart!.timestamp);
    });
  });

  describe("integration", () => {
    const PROXY_BASE_URL =
      process.env.PROXY_BASE_URL ||
      "https://platform-template.labs.vercel.dev/api/ai/proxy";
    const SESSION_URL =
      "https://platform-template.labs.vercel.dev/api/ai/session";

    let provider: ClaudeAgentProvider;
    let sandbox: Sandbox;
    let sandboxContext: SandboxContext;
    let proxyConfig: ProxyConfig;

    beforeAll(async () => {
      provider = new ClaudeAgentProvider();

      // Create session for proxy
      const response = await fetch(SESSION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.status}`);
      }

      const data = await response.json();

      proxyConfig = {
        sessionId: data.sessionId,
        baseUrl: PROXY_BASE_URL,
      };

      // Create a fresh sandbox with Claude CLI
      sandbox = await Sandbox.create({
        ports: [3000],
        timeout: 300_000,
      });

      // Install Claude CLI
      const installResult = await sandbox.runCommand({
        cmd: "sh",
        args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash"],
      });
      if (installResult.exitCode !== 0) {
        throw new Error(`Failed to install Claude CLI: ${await installResult.stderr()}`);
      }

      sandboxContext = {
        sandboxId: sandbox.sandboxId,
        sandbox,
        templateId: "nextjs",
      };
    }, 120_000);

    afterAll(async () => {
      if (sandbox) {
        await sandbox.stop();
      }
    });

    test("should stream tool-start before tool-result for Write operations", async () => {
      const chunks: { chunk: StreamChunk; timestamp: number }[] = [];

      // Ask Claude to write a simple file - this will trigger a Write tool call
      for await (const chunk of provider.execute({
        prompt: "Create a file at /tmp/test.txt with the content 'Hello World'. Do not read it back, just write it.",
        sandboxContext,
        proxyConfig,
      })) {
        chunks.push({ chunk, timestamp: Date.now() });
      }

      // Find tool events
      const toolStarts = chunks.filter((c) => c.chunk.type === "tool-start");
      const toolResults = chunks.filter((c) => c.chunk.type === "tool-result");

      expect(toolStarts.length).toBeGreaterThan(0);
      expect(toolResults.length).toBeGreaterThan(0);

      // Find matching tool-start and tool-result for the Write operation
      const writeStart = chunks.find(
        (c) =>
          c.chunk.type === "tool-start" &&
          (c.chunk.toolName === "Write" || c.chunk.toolName.includes("write"))
      );
      
      if (writeStart && writeStart.chunk.type === "tool-start") {
        const toolCallId = writeStart.chunk.toolCallId;
        const writeResult = chunks.find(
          (c) =>
            c.chunk.type === "tool-result" &&
            c.chunk.toolCallId === toolCallId
        );

        if (writeResult) {
          const timeDiff = writeResult.timestamp - writeStart.timestamp;
          // The key assertion: tool-start should arrive meaningfully before tool-result
          // If this fails with < 50ms, the streaming isn't working properly
          expect(timeDiff).toBeGreaterThan(50);
        }
      }
    }, 180_000);
  });
});
