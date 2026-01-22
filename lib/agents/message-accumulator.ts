/**
 * MessageAccumulator
 *
 * Accumulates StreamChunks into UIMessage format for the client.
 * Used by the useAgentChat hook to build messages from the stream.
 */

import type { UIMessage, UIMessagePart } from "ai";
import type { StreamChunk, DataPartType, DataPartPayload } from "./types";

// ============================================================================
// UIMessage Type Definitions
// ============================================================================

/**
 * Message metadata attached to each assistant message.
 */
export type MessageMetadata = {
  agentId?: string;
  model?: string;
  duration?: number;
  inputTokens?: number;
  outputTokens?: number;
};

/**
 * Our custom data parts that extend the standard UIMessage parts.
 */
export type DataPart = DataPartPayload;

/**
 * The ChatMessage type used throughout the app.
 * Uses UIMessage with our custom metadata and data parts.
 */
export type ChatMessage = UIMessage<MessageMetadata, DataPart, Record<string, never>>;

/**
 * Individual part of a ChatMessage.
 */
export type ChatMessagePart = UIMessagePart<DataPart, Record<string, never>>;

// ============================================================================
// MessageAccumulator
// ============================================================================

/**
 * Accumulates StreamChunks into a complete UIMessage.
 *
 * Usage:
 * ```typescript
 * const accumulator = new MessageAccumulator(messageId, { agentId: "claude" });
 *
 * for await (const chunk of agentStream) {
 *   const message = accumulator.process(chunk);
 *   // Update UI with message
 * }
 * ```
 */
export class MessageAccumulator {
  private message: ChatMessage;
  private currentTextPart: Extract<ChatMessagePart, { type: "text" }> | null = null;
  private currentReasoningPart: Extract<ChatMessagePart, { type: "reasoning" }> | null = null;
  private toolParts: Map<string, ChatMessagePart> = new Map();

  constructor(id: string, metadata?: MessageMetadata) {
    this.message = {
      id,
      role: "assistant",
      parts: [],
      metadata,
    };
  }

  /**
   * Process a StreamChunk and return the updated message.
   * The returned message object is mutated in place for efficiency.
   */
  process(chunk: StreamChunk): ChatMessage {
    switch (chunk.type) {
      case "message-start":
        // Already initialized in constructor
        break;

      case "text-delta":
        this.handleTextDelta(chunk.text);
        break;

      case "reasoning-delta":
        this.handleReasoningDelta(chunk.text);
        break;

      case "tool-start":
        this.handleToolStart(chunk.toolCallId, chunk.toolName);
        break;

      case "tool-input-delta":
        this.handleToolInputDelta(chunk.toolCallId, chunk.input);
        break;

      case "tool-result":
        this.handleToolResult(chunk.toolCallId, chunk.output, chunk.isError);
        break;

      case "data":
        this.handleData(chunk.dataType, chunk.data);
        break;

      case "message-end":
        this.handleMessageEnd(chunk.usage);
        break;

      case "error":
        this.handleError(chunk.message);
        break;
    }

    return this.message;
  }

  /**
   * Get the current accumulated message.
   */
  getMessage(): ChatMessage {
    return this.message;
  }

  /**
   * Reset the accumulator for a new message.
   */
  reset(id: string, metadata?: MessageMetadata): void {
    this.message = {
      id,
      role: "assistant",
      parts: [],
      metadata,
    };
    this.currentTextPart = null;
    this.currentReasoningPart = null;
    this.toolParts.clear();
  }

  // ============================================================================
  // Private Handlers
  // ============================================================================

  private handleTextDelta(text: string): void {
    if (!this.currentTextPart) {
      this.currentTextPart = { type: "text", text: "" };
      this.message.parts.push(this.currentTextPart);
    }
    this.currentTextPart.text += text;
  }

  private handleReasoningDelta(text: string): void {
    if (!this.currentReasoningPart) {
      this.currentReasoningPart = { type: "reasoning", text: "", providerMetadata: undefined };
      this.message.parts.push(this.currentReasoningPart);
    }
    this.currentReasoningPart.text += text;
  }

  private handleToolStart(toolCallId: string, toolName: string): void {
    const toolPart: ChatMessagePart = {
      type: "tool-invocation",
      toolInvocation: {
        state: "call",
        toolCallId,
        toolName,
        args: {},
      },
    };
    this.toolParts.set(toolCallId, toolPart);
    this.message.parts.push(toolPart);
    // Reset text accumulation after tool - next text will be a new part
    this.currentTextPart = null;
    this.currentReasoningPart = null;
  }

  private handleToolInputDelta(toolCallId: string, input: string): void {
    const toolPart = this.toolParts.get(toolCallId);
    if (toolPart && toolPart.type === "tool-invocation") {
      // Accumulate the input string - we'll parse it at the end
      const currentArgs = toolPart.toolInvocation.args;
      if (typeof currentArgs === "object" && currentArgs !== null) {
        // Store as raw string to parse later
        (currentArgs as Record<string, unknown>).__rawInput =
          ((currentArgs as Record<string, unknown>).__rawInput || "") + input;
      }
    }
  }

  private handleToolResult(
    toolCallId: string,
    output: string,
    isError?: boolean
  ): void {
    const toolPart = this.toolParts.get(toolCallId);
    if (toolPart && toolPart.type === "tool-invocation") {
      // Finalize the args by parsing the accumulated raw input
      const args = toolPart.toolInvocation.args as Record<string, unknown>;
      if (args.__rawInput) {
        try {
          const parsed = JSON.parse(args.__rawInput as string);
          toolPart.toolInvocation.args = parsed;
        } catch {
          // Keep as raw string if not valid JSON
          toolPart.toolInvocation.args = { input: args.__rawInput };
        }
      }

      // Update to result state
      toolPart.toolInvocation = {
        ...toolPart.toolInvocation,
        state: "result",
        result: isError ? { error: output } : output,
      };
    }
  }

  private handleData<T extends DataPartType>(
    dataType: T,
    data: DataPartPayload[T]
  ): void {
    // Add as a data part with the type prefixed
    const dataPart = {
      type: `data-${dataType}` as const,
      data,
    } as ChatMessagePart;
    this.message.parts.push(dataPart);
  }

  private handleMessageEnd(usage?: {
    inputTokens: number;
    outputTokens: number;
  }): void {
    if (usage && this.message.metadata) {
      this.message.metadata.inputTokens = usage.inputTokens;
      this.message.metadata.outputTokens = usage.outputTokens;
    }
  }

  private handleError(errorMessage: string): void {
    // Add error as a text part with error indicator
    const errorPart: ChatMessagePart = {
      type: "text",
      text: `Error: ${errorMessage}`,
    };
    this.message.parts.push(errorPart);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Extract sandbox ID from accumulated messages.
 */
export function extractSandboxId(messages: ChatMessage[]): string | null {
  for (const message of messages) {
    for (const part of message.parts) {
      if (
        part.type === ("data-sandbox-status" as ChatMessagePart["type"]) &&
        "data" in part &&
        (part.data as DataPartPayload["sandbox-status"]).sandboxId
      ) {
        return (part.data as DataPartPayload["sandbox-status"]).sandboxId!;
      }
    }
  }
  return null;
}

/**
 * Extract the most recent preview URL from messages.
 */
export function extractPreviewUrl(messages: ChatMessage[]): string | null {
  for (const message of [...messages].reverse()) {
    for (const part of message.parts) {
      if (
        part.type === ("data-preview-url" as ChatMessagePart["type"]) &&
        "data" in part
      ) {
        return (part.data as DataPartPayload["preview-url"]).url;
      }
    }
  }
  return null;
}

/**
 * Extract all file paths that have been written.
 */
export function extractWrittenFiles(messages: ChatMessage[]): string[] {
  const files = new Set<string>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (
        part.type === ("data-file-written" as ChatMessagePart["type"]) &&
        "data" in part
      ) {
        files.add((part.data as DataPartPayload["file-written"]).path);
      }
    }
  }
  return Array.from(files);
}
