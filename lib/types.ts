/**
 * Shared Types
 *
 * Type definitions for the platform template.
 */

import type { UIMessage, DataUIPart } from "ai";

// ============================================================================
// Data Part Types (matches agent StreamChunk data parts)
// ============================================================================

export type DataPart = {
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

// ============================================================================
// Message Types
// ============================================================================

export type MessageMetadata = {
  agentId?: string;
  model?: string;
  duration?: number;
};

/**
 * Chat message type with our custom data parts.
 * Uses dynamic tools since agent tool names aren't statically known.
 */
export type ChatMessage = UIMessage<MessageMetadata, DataPart>;

/**
 * Data UI Part with our custom data types.
 */
export type ChatDataPart = DataUIPart<DataPart>;

// Re-export for convenience
export type { UIMessage, DataUIPart } from "ai";
