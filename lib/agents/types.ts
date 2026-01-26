/**
 * Unified Agent Interface Types
 *
 * This module defines the common interface for all agent providers (Claude, Codex, OpenCode).
 * Each provider implements this interface and handles SDK-specific conversion internally.
 */

import type { Sandbox } from "@vercel/sandbox";

// ============================================================================
// Sandbox Context
// ============================================================================

/**
 * Context passed to agent providers for sandbox operations.
 */
export interface SandboxContext {
  sandboxId: string;
  sandbox: Sandbox;
}

// ============================================================================
// StreamChunk - The unified output format
// ============================================================================

/**
 * Custom data parts for streaming agent/sandbox status.
 * These get converted to UIMessage data parts on the client.
 */
export type DataPartType =
  | "agent-status"
  | "sandbox-status"
  | "file-written"
  | "command-output"
  | "preview-url";

export type DataPartPayload = {
  "agent-status": {
    status: "thinking" | "tool-use" | "done" | "error";
    message?: string;
  };
  "sandbox-status": {
    sandboxId?: string;
    status: "creating" | "ready" | "error";
    error?: string;
  };
  "file-written": {
    path: string;
  };
  "command-output": {
    command: string;
    output: string;
    stream: "stdout" | "stderr";
    exitCode?: number;
  };
  "preview-url": {
    url: string;
    port: number;
  };
};

/**
 * StreamChunk is the unified streaming format that all agent providers yield.
 *
 * The conversion from SDK-specific message formats to StreamChunk happens
 * INSIDE each provider - this is the public interface.
 */
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

// ============================================================================
// Agent Provider Interface
// ============================================================================

/**
 * Parameters passed to the agent's execute method.
 */
export interface ExecuteParams {
  /** The user's prompt/message */
  prompt: string;
  /** The sandbox context for file/command operations */
  sandboxContext: SandboxContext;
  /** Optional signal for aborting the operation */
  signal?: AbortSignal;
  /** Optional session ID to resume a previous conversation */
  sessionId?: string;
  /** Optional model override (e.g., 'haiku' for tests) */
  model?: string;
}

/**
 * The unified interface that all agent providers must implement.
 *
 * Key design principles:
 * 1. Conversion is internal - each provider handles its own SDK → StreamChunk conversion
 * 2. Single public interface - all providers yield StreamChunk from execute()
 * 3. No leaky abstractions - API routes and clients only see StreamChunk
 */
export interface AgentProvider {
  /** Unique identifier for this agent provider */
  id: string;

  /** Display name for UI */
  name: string;

  /** Optional description */
  description?: string;

  /**
   * Execute a prompt and stream responses.
   *
   * Yields StreamChunk objects that the API route streams to the client.
   * The client uses MessageAccumulator to build these into UIMessages.
   */
  execute(params: ExecuteParams): AsyncIterable<StreamChunk>;
}

// ============================================================================
// Type Guards
// ============================================================================

export function isTextDelta(chunk: StreamChunk): chunk is Extract<StreamChunk, { type: "text-delta" }> {
  return chunk.type === "text-delta";
}

export function isToolStart(chunk: StreamChunk): chunk is Extract<StreamChunk, { type: "tool-start" }> {
  return chunk.type === "tool-start";
}

export function isToolResult(chunk: StreamChunk): chunk is Extract<StreamChunk, { type: "tool-result" }> {
  return chunk.type === "tool-result";
}

export function isDataChunk(chunk: StreamChunk): chunk is Extract<StreamChunk, { type: "data" }> {
  return chunk.type === "data";
}

export function isMessageEnd(chunk: StreamChunk): chunk is Extract<StreamChunk, { type: "message-end" }> {
  return chunk.type === "message-end";
}

export function isError(chunk: StreamChunk): chunk is Extract<StreamChunk, { type: "error" }> {
  return chunk.type === "error";
}
