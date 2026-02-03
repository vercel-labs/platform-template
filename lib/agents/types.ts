import type { Sandbox } from "@vercel/sandbox";
import type { DataPartType, DataPartPayload } from "@/lib/types";

export interface SandboxContext {
  sandboxId: string;
  sandbox: Sandbox;
}

export type StreamChunk =
  | { type: "message-start"; id: string; role: "assistant"; sessionId?: string }
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | { type: "tool-start"; toolCallId: string; toolName: string }
  | { type: "tool-input-delta"; toolCallId: string; input: string }
  | {
      type: "tool-result";
      toolCallId: string;
      output: string;
      isError?: boolean;
    }
  | {
      type: "data";
      dataType: DataPartType;
      data: DataPartPayload[DataPartType];
    }
  | {
      type: "message-end";
      usage?: { inputTokens: number; outputTokens: number };
    }
  | { type: "error"; message: string; code?: string };

export interface ProxyConfig {
  baseUrl: string;
  sessionId: string;
}

export interface ExecuteParams {
  prompt: string;
  sandboxContext: SandboxContext;
  sessionId?: string;
  proxyConfig: ProxyConfig;
}

export interface AgentProvider {
  id: string;
  name: string;
  description: string;
  /** Logo identifier for UI (e.g., "anthropic", "openai") */
  logo: string;

  execute(params: ExecuteParams): AsyncIterable<StreamChunk>;
}

export function isTextDelta(
  chunk: StreamChunk,
): chunk is Extract<StreamChunk, { type: "text-delta" }> {
  return chunk.type === "text-delta";
}

export function isToolStart(
  chunk: StreamChunk,
): chunk is Extract<StreamChunk, { type: "tool-start" }> {
  return chunk.type === "tool-start";
}

export function isToolResult(
  chunk: StreamChunk,
): chunk is Extract<StreamChunk, { type: "tool-result" }> {
  return chunk.type === "tool-result";
}

export function isDataChunk(
  chunk: StreamChunk,
): chunk is Extract<StreamChunk, { type: "data" }> {
  return chunk.type === "data";
}

export function isMessageEnd(
  chunk: StreamChunk,
): chunk is Extract<StreamChunk, { type: "message-end" }> {
  return chunk.type === "message-end";
}

export function isError(
  chunk: StreamChunk,
): chunk is Extract<StreamChunk, { type: "error" }> {
  return chunk.type === "error";
}
