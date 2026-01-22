import { test, expect, describe, beforeEach } from "vitest";
import {
  MessageAccumulator,
  extractSandboxId,
  extractPreviewUrl,
  extractWrittenFiles,
  type ChatMessage,
} from "../message-accumulator";
import type { StreamChunk } from "../types";

describe("MessageAccumulator", () => {
  let accumulator: MessageAccumulator;
  const testMessageId = "test-msg-123";
  const testMetadata = { agentId: "claude-agent" };

  beforeEach(() => {
    accumulator = new MessageAccumulator(testMessageId, testMetadata);
  });

  describe("initialization", () => {
    test("creates message with correct id and role", () => {
      const message = accumulator.getMessage();
      expect(message.id).toBe(testMessageId);
      expect(message.role).toBe("assistant");
      expect(message.parts).toEqual([]);
      expect(message.metadata).toEqual(testMetadata);
    });

    test("reset clears state and sets new id", () => {
      // Add some content first
      accumulator.process({ type: "text-delta", text: "Hello" });

      // Reset
      accumulator.reset("new-id", { agentId: "other-agent" });

      const message = accumulator.getMessage();
      expect(message.id).toBe("new-id");
      expect(message.parts).toEqual([]);
      expect(message.metadata).toEqual({ agentId: "other-agent" });
    });
  });

  describe("text-delta handling", () => {
    test("accumulates text into a single part", () => {
      accumulator.process({ type: "text-delta", text: "Hello" });
      accumulator.process({ type: "text-delta", text: " world" });
      accumulator.process({ type: "text-delta", text: "!" });

      const message = accumulator.getMessage();
      expect(message.parts).toHaveLength(1);
      expect(message.parts[0]).toEqual({ type: "text", text: "Hello world!" });
    });

    test("creates new text part after tool invocation", () => {
      accumulator.process({ type: "text-delta", text: "Before tool" });
      accumulator.process({
        type: "tool-start",
        toolCallId: "tool-1",
        toolName: "read_file",
      });
      accumulator.process({ type: "text-delta", text: "After tool" });

      const message = accumulator.getMessage();
      expect(message.parts).toHaveLength(3);
      expect(message.parts[0]).toEqual({ type: "text", text: "Before tool" });
      expect(message.parts[1].type).toBe("tool-invocation");
      expect(message.parts[2]).toEqual({ type: "text", text: "After tool" });
    });
  });

  describe("reasoning-delta handling", () => {
    test("accumulates reasoning into a single part", () => {
      accumulator.process({ type: "reasoning-delta", text: "Let me think..." });
      accumulator.process({ type: "reasoning-delta", text: " about this." });

      const message = accumulator.getMessage();
      expect(message.parts).toHaveLength(1);
      expect(message.parts[0].type).toBe("reasoning");
      expect((message.parts[0] as { type: "reasoning"; text: string }).text).toBe(
        "Let me think... about this."
      );
    });
  });

  describe("tool invocation handling", () => {
    test("creates tool-invocation part on tool-start", () => {
      accumulator.process({
        type: "tool-start",
        toolCallId: "tool-123",
        toolName: "write_file",
      });

      const message = accumulator.getMessage();
      expect(message.parts).toHaveLength(1);
      expect(message.parts[0].type).toBe("tool-invocation");
      const part = message.parts[0] as Extract<
        (typeof message.parts)[0],
        { type: "tool-invocation" }
      >;
      expect(part.toolInvocation.toolCallId).toBe("tool-123");
      expect(part.toolInvocation.toolName).toBe("write_file");
      expect(part.toolInvocation.state).toBe("call");
    });

    test("accumulates tool input and parses as JSON on result", () => {
      accumulator.process({
        type: "tool-start",
        toolCallId: "tool-123",
        toolName: "write_file",
      });
      accumulator.process({
        type: "tool-input-delta",
        toolCallId: "tool-123",
        input: '{"path": "/test.txt"',
      });
      accumulator.process({
        type: "tool-input-delta",
        toolCallId: "tool-123",
        input: ', "content": "hello"}',
      });
      accumulator.process({
        type: "tool-result",
        toolCallId: "tool-123",
        output: "File written successfully",
      });

      const message = accumulator.getMessage();
      expect(message.parts).toHaveLength(1);
      const part = message.parts[0] as Extract<
        (typeof message.parts)[0],
        { type: "tool-invocation" }
      >;
      expect(part.toolInvocation.state).toBe("result");
      expect(part.toolInvocation.args).toEqual({
        path: "/test.txt",
        content: "hello",
      });
      expect(part.toolInvocation.result).toBe("File written successfully");
    });

    test("handles tool error result", () => {
      accumulator.process({
        type: "tool-start",
        toolCallId: "tool-123",
        toolName: "run_command",
      });
      accumulator.process({
        type: "tool-result",
        toolCallId: "tool-123",
        output: "Command failed: exit code 1",
        isError: true,
      });

      const message = accumulator.getMessage();
      const part = message.parts[0] as Extract<
        (typeof message.parts)[0],
        { type: "tool-invocation" }
      >;
      expect(part.toolInvocation.state).toBe("result");
      expect(part.toolInvocation.result).toEqual({
        error: "Command failed: exit code 1",
      });
    });

    test("handles multiple tool calls", () => {
      // First tool
      accumulator.process({
        type: "tool-start",
        toolCallId: "tool-1",
        toolName: "read_file",
      });
      accumulator.process({
        type: "tool-result",
        toolCallId: "tool-1",
        output: "file contents",
      });

      // Second tool
      accumulator.process({
        type: "tool-start",
        toolCallId: "tool-2",
        toolName: "write_file",
      });
      accumulator.process({
        type: "tool-result",
        toolCallId: "tool-2",
        output: "written",
      });

      const message = accumulator.getMessage();
      expect(message.parts).toHaveLength(2);
      expect(
        (
          message.parts[0] as Extract<
            (typeof message.parts)[0],
            { type: "tool-invocation" }
          >
        ).toolInvocation.toolName
      ).toBe("read_file");
      expect(
        (
          message.parts[1] as Extract<
            (typeof message.parts)[0],
            { type: "tool-invocation" }
          >
        ).toolInvocation.toolName
      ).toBe("write_file");
    });
  });

  describe("data part handling", () => {
    test("adds sandbox-status data part", () => {
      accumulator.process({
        type: "data",
        dataType: "sandbox-status",
        data: { sandboxId: "sandbox-123", status: "ready" },
      });

      const message = accumulator.getMessage();
      expect(message.parts).toHaveLength(1);
      expect(message.parts[0].type).toBe("data-sandbox-status");
      expect((message.parts[0] as { type: string; data: unknown }).data).toEqual({
        sandboxId: "sandbox-123",
        status: "ready",
      });
    });

    test("adds file-written data part", () => {
      accumulator.process({
        type: "data",
        dataType: "file-written",
        data: { path: "/vercel/sandbox/index.ts" },
      });

      const message = accumulator.getMessage();
      expect(message.parts[0].type).toBe("data-file-written");
    });

    test("adds preview-url data part", () => {
      accumulator.process({
        type: "data",
        dataType: "preview-url",
        data: { url: "https://preview.vercel.app", port: 3000 },
      });

      const message = accumulator.getMessage();
      expect(message.parts[0].type).toBe("data-preview-url");
    });
  });

  describe("message-end handling", () => {
    test("updates metadata with usage on message-end", () => {
      accumulator.process({ type: "text-delta", text: "Hello" });
      accumulator.process({
        type: "message-end",
        usage: { inputTokens: 100, outputTokens: 50 },
      });

      const message = accumulator.getMessage();
      expect(message.metadata?.inputTokens).toBe(100);
      expect(message.metadata?.outputTokens).toBe(50);
    });

    test("handles message-end without usage", () => {
      accumulator.process({ type: "text-delta", text: "Hello" });
      accumulator.process({ type: "message-end" });

      const message = accumulator.getMessage();
      // Should not throw
      expect(message.parts).toHaveLength(1);
    });
  });

  describe("error handling", () => {
    test("adds error as text part", () => {
      accumulator.process({
        type: "error",
        message: "Rate limit exceeded",
      });

      const message = accumulator.getMessage();
      expect(message.parts).toHaveLength(1);
      expect(message.parts[0]).toEqual({
        type: "text",
        text: "Error: Rate limit exceeded",
      });
    });
  });

  describe("complex conversation flow", () => {
    test("handles typical agent conversation", () => {
      const chunks: StreamChunk[] = [
        { type: "message-start", id: testMessageId, role: "assistant" },
        {
          type: "data",
          dataType: "agent-status",
          data: { status: "thinking" },
        },
        {
          type: "reasoning-delta",
          text: "Let me create a simple app...",
        },
        { type: "text-delta", text: "I'll create a React app for you.\n\n" },
        {
          type: "tool-start",
          toolCallId: "tool-1",
          toolName: "write_file",
        },
        {
          type: "tool-input-delta",
          toolCallId: "tool-1",
          input: '{"path": "/vercel/sandbox/App.tsx", "content": "export default function App() { return <h1>Hello</h1> }"}',
        },
        {
          type: "tool-result",
          toolCallId: "tool-1",
          output: "File written",
        },
        {
          type: "data",
          dataType: "file-written",
          data: { path: "/vercel/sandbox/App.tsx" },
        },
        { type: "text-delta", text: "Now let me start the server..." },
        {
          type: "tool-start",
          toolCallId: "tool-2",
          toolName: "run_command",
        },
        {
          type: "tool-result",
          toolCallId: "tool-2",
          output: "Server running on port 3000",
        },
        {
          type: "data",
          dataType: "preview-url",
          data: { url: "https://preview.vercel.app", port: 3000 },
        },
        { type: "text-delta", text: "\n\nYour app is ready!" },
        {
          type: "message-end",
          usage: { inputTokens: 500, outputTokens: 200 },
        },
      ];

      for (const chunk of chunks) {
        accumulator.process(chunk);
      }

      const message = accumulator.getMessage();

      // Check parts structure
      expect(message.parts.length).toBeGreaterThan(0);

      // Should have: agent-status, reasoning, text, tool, file-written, text, tool, preview-url, text
      const partTypes = message.parts.map((p) => p.type);
      expect(partTypes).toContain("data-agent-status");
      expect(partTypes).toContain("reasoning");
      expect(partTypes).toContain("text");
      expect(partTypes).toContain("tool-invocation");
      expect(partTypes).toContain("data-file-written");
      expect(partTypes).toContain("data-preview-url");

      // Check usage was recorded
      expect(message.metadata?.inputTokens).toBe(500);
      expect(message.metadata?.outputTokens).toBe(200);
    });
  });
});

describe("utility functions", () => {
  describe("extractSandboxId", () => {
    test("extracts sandbox ID from messages", () => {
      const messages: ChatMessage[] = [
        {
          id: "msg-1",
          role: "assistant",
          parts: [
            {
              type: "data-sandbox-status" as const,
              data: { sandboxId: "sandbox-abc123", status: "ready" as const },
            } as unknown as ChatMessage["parts"][0],
          ],
        },
      ];

      expect(extractSandboxId(messages)).toBe("sandbox-abc123");
    });

    test("returns null when no sandbox ID found", () => {
      const messages: ChatMessage[] = [
        {
          id: "msg-1",
          role: "assistant",
          parts: [{ type: "text", text: "Hello" }],
        },
      ];

      expect(extractSandboxId(messages)).toBeNull();
    });
  });

  describe("extractPreviewUrl", () => {
    test("extracts most recent preview URL", () => {
      const messages: ChatMessage[] = [
        {
          id: "msg-1",
          role: "assistant",
          parts: [
            {
              type: "data-preview-url" as const,
              data: { url: "https://old.vercel.app", port: 3000 },
            } as unknown as ChatMessage["parts"][0],
          ],
        },
        {
          id: "msg-2",
          role: "assistant",
          parts: [
            {
              type: "data-preview-url" as const,
              data: { url: "https://new.vercel.app", port: 3000 },
            } as unknown as ChatMessage["parts"][0],
          ],
        },
      ];

      expect(extractPreviewUrl(messages)).toBe("https://new.vercel.app");
    });
  });

  describe("extractWrittenFiles", () => {
    test("extracts all written file paths", () => {
      const messages: ChatMessage[] = [
        {
          id: "msg-1",
          role: "assistant",
          parts: [
            {
              type: "data-file-written" as const,
              data: { path: "/vercel/sandbox/index.ts" },
            } as unknown as ChatMessage["parts"][0],
            {
              type: "data-file-written" as const,
              data: { path: "/vercel/sandbox/app.tsx" },
            } as unknown as ChatMessage["parts"][0],
          ],
        },
        {
          id: "msg-2",
          role: "assistant",
          parts: [
            {
              type: "data-file-written" as const,
              data: { path: "/vercel/sandbox/styles.css" },
            } as unknown as ChatMessage["parts"][0],
          ],
        },
      ];

      const files = extractWrittenFiles(messages);
      expect(files).toContain("/vercel/sandbox/index.ts");
      expect(files).toContain("/vercel/sandbox/app.tsx");
      expect(files).toContain("/vercel/sandbox/styles.css");
      expect(files).toHaveLength(3);
    });

    test("deduplicates file paths", () => {
      const messages: ChatMessage[] = [
        {
          id: "msg-1",
          role: "assistant",
          parts: [
            {
              type: "data-file-written" as const,
              data: { path: "/vercel/sandbox/index.ts" },
            } as unknown as ChatMessage["parts"][0],
          ],
        },
        {
          id: "msg-2",
          role: "assistant",
          parts: [
            {
              type: "data-file-written" as const,
              data: { path: "/vercel/sandbox/index.ts" }, // Same file
            } as unknown as ChatMessage["parts"][0],
          ],
        },
      ];

      const files = extractWrittenFiles(messages);
      expect(files).toHaveLength(1);
    });
  });
});
