import { test, expect, describe } from "vitest";
import { toUIMessageChunk, createAgentStream } from "../stream";
import type { StreamChunk } from "../types";

describe("toUIMessageChunk", () => {
  const partId = "test-part-id";

  test("converts text-delta", () => {
    const chunk: StreamChunk = { type: "text-delta", text: "Hello" };
    const result = toUIMessageChunk(chunk, partId);
    expect(result).toEqual({
      type: "text-delta",
      id: partId,
      delta: "Hello",
    });
  });

  test("converts reasoning-delta", () => {
    const chunk: StreamChunk = { type: "reasoning-delta", text: "Thinking..." };
    const result = toUIMessageChunk(chunk, partId);
    expect(result).toEqual({
      type: "reasoning-delta",
      id: `reasoning-${partId}`,
      delta: "Thinking...",
    });
  });

  test("converts tool-start", () => {
    const chunk: StreamChunk = {
      type: "tool-start",
      toolCallId: "tool-123",
      toolName: "write_file",
    };
    const result = toUIMessageChunk(chunk, partId);
    expect(result).toEqual({
      type: "tool-input-start",
      toolCallId: "tool-123",
      toolName: "write_file",
    });
  });

  test("converts tool-input-delta", () => {
    const chunk: StreamChunk = {
      type: "tool-input-delta",
      toolCallId: "tool-123",
      input: '{"path": "/test.txt"}',
    };
    const result = toUIMessageChunk(chunk, partId);
    expect(result).toEqual({
      type: "tool-input-delta",
      toolCallId: "tool-123",
      inputTextDelta: '{"path": "/test.txt"}',
    });
  });

  test("converts tool-result success", () => {
    const chunk: StreamChunk = {
      type: "tool-result",
      toolCallId: "tool-123",
      output: "File written successfully",
    };
    const result = toUIMessageChunk(chunk, partId);
    expect(result).toEqual({
      type: "tool-output-available",
      toolCallId: "tool-123",
      output: "File written successfully",
    });
  });

  test("converts tool-result error", () => {
    const chunk: StreamChunk = {
      type: "tool-result",
      toolCallId: "tool-123",
      output: "Permission denied",
      isError: true,
    };
    const result = toUIMessageChunk(chunk, partId);
    expect(result).toEqual({
      type: "tool-output-error",
      toolCallId: "tool-123",
      errorText: "Permission denied",
    });
  });

  test("converts data chunk", () => {
    const chunk: StreamChunk = {
      type: "data",
      dataType: "sandbox-status",
      data: { sandboxId: "sbx-123", status: "ready" },
    };
    const result = toUIMessageChunk(chunk, partId);
    expect(result).toEqual({
      type: "data-sandbox-status",
      data: { sandboxId: "sbx-123", status: "ready" },
    });
  });

  test("converts error", () => {
    const chunk: StreamChunk = {
      type: "error",
      message: "Rate limit exceeded",
    };
    const result = toUIMessageChunk(chunk, partId);
    expect(result).toEqual({
      type: "error",
      errorText: "Rate limit exceeded",
    });
  });

  test("returns null for message-start", () => {
    const chunk: StreamChunk = {
      type: "message-start",
      id: "msg-123",
      role: "assistant",
    };
    const result = toUIMessageChunk(chunk, partId);
    expect(result).toBeNull();
  });

  test("returns null for message-end", () => {
    const chunk: StreamChunk = {
      type: "message-end",
      usage: { inputTokens: 100, outputTokens: 50 },
    };
    const result = toUIMessageChunk(chunk, partId);
    expect(result).toBeNull();
  });
});

describe("createAgentStream", () => {
  async function collectStream<T>(stream: ReadableStream<T>): Promise<T[]> {
    const reader = stream.getReader();
    const chunks: T[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return chunks;
  }

  async function* generateChunks(chunks: StreamChunk[]): AsyncIterable<StreamChunk> {
    for (const chunk of chunks) {
      yield chunk;
    }
  }

  test("wraps text deltas with start/end", async () => {
    const input: StreamChunk[] = [
      { type: "text-delta", text: "Hello" },
      { type: "text-delta", text: " world" },
    ];

    const stream = createAgentStream(generateChunks(input));
    const chunks = await collectStream(stream);

    expect(chunks[0].type).toBe("text-start");
    expect(chunks[1].type).toBe("text-delta");
    expect(chunks[2].type).toBe("text-delta");
    expect(chunks[3].type).toBe("text-end");
  });

  test("wraps reasoning deltas with start/end", async () => {
    const input: StreamChunk[] = [
      { type: "reasoning-delta", text: "Let me think..." },
    ];

    const stream = createAgentStream(generateChunks(input));
    const chunks = await collectStream(stream);

    expect(chunks[0].type).toBe("reasoning-start");
    expect(chunks[1].type).toBe("reasoning-delta");
    expect(chunks[2].type).toBe("reasoning-end");
  });

  test("handles tool calls interleaved with text", async () => {
    const input: StreamChunk[] = [
      { type: "text-delta", text: "I'll write a file." },
      { type: "tool-start", toolCallId: "tool-1", toolName: "write_file" },
      { type: "tool-result", toolCallId: "tool-1", output: "Done" },
      { type: "text-delta", text: "File written!" },
    ];

    const stream = createAgentStream(generateChunks(input));
    const chunks = await collectStream(stream);

    const types = chunks.map((c) => c.type);
    
    // Should have: text-start, text-delta, text-end, tool-input-start, tool-output-available, text-start, text-delta, text-end
    expect(types).toContain("text-start");
    expect(types).toContain("text-delta");
    expect(types).toContain("text-end");
    expect(types).toContain("tool-input-start");
    expect(types).toContain("tool-output-available");
    
    // Count text-start occurrences - should be 2 (before and after tool)
    const textStarts = types.filter((t) => t === "text-start").length;
    expect(textStarts).toBe(2);
  });

  test("handles errors gracefully", async () => {
    async function* failingGenerator(): AsyncIterable<StreamChunk> {
      yield { type: "text-delta", text: "Starting..." };
      throw new Error("Connection lost");
    }

    const stream = createAgentStream(failingGenerator());
    const chunks = await collectStream(stream);

    const lastChunk = chunks[chunks.length - 1];
    expect(lastChunk.type).toBe("error");
    if (lastChunk.type === "error") {
      expect(lastChunk.errorText).toBe("Connection lost");
    }
  });
});
