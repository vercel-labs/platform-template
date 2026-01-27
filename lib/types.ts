/**
 * Shared Types
 *
 * Single source of truth for type definitions across the platform.
 * Uses zod schemas for runtime validation and type inference.
 */

import { z } from "zod";
import type { UIMessage, DataUIPart } from "ai";

// ============================================================================
// Data Part Types - Used by both agents and UI
// ============================================================================

/**
 * Type-safe keys for data parts. Use these instead of magic strings.
 */
export const DATA_PART_TYPES = {
  AGENT_STATUS: "agent-status",
  SANDBOX_STATUS: "sandbox-status",
  FILE_WRITTEN: "file-written",
  COMMAND_OUTPUT: "command-output",
  PREVIEW_URL: "preview-url",
} as const;

export type DataPartType = (typeof DATA_PART_TYPES)[keyof typeof DATA_PART_TYPES];

// ============================================================================
// Zod Schemas for Data Parts
// ============================================================================

export const AgentStatusSchema = z.object({
  status: z.enum(["thinking", "tool-use", "done", "error"]),
  message: z.string().optional(),
});

export const SandboxStatusSchema = z.object({
  sandboxId: z.string().optional(),
  status: z.enum(["creating", "warming", "ready", "error"]),
  error: z.string().optional(),
});

export const FileWrittenSchema = z.object({
  path: z.string(),
});

export const CommandOutputSchema = z.object({
  command: z.string(),
  output: z.string(),
  stream: z.enum(["stdout", "stderr"]),
  exitCode: z.number().optional(),
});

export const PreviewUrlSchema = z.object({
  url: z.string(),
  port: z.number(),
});

// ============================================================================
// Inferred Types from Schemas
// ============================================================================

export type AgentStatusData = z.infer<typeof AgentStatusSchema>;
export type SandboxStatusData = z.infer<typeof SandboxStatusSchema>;
export type FileWrittenData = z.infer<typeof FileWrittenSchema>;
export type CommandOutputData = z.infer<typeof CommandOutputSchema>;
export type PreviewUrlData = z.infer<typeof PreviewUrlSchema>;

// ============================================================================
// Data Part Payload Map
// ============================================================================

/**
 * Maps data part type keys to their payload types.
 * Used for type-safe data part handling.
 */
export type DataPartPayload = {
  [DATA_PART_TYPES.AGENT_STATUS]: AgentStatusData;
  [DATA_PART_TYPES.SANDBOX_STATUS]: SandboxStatusData;
  [DATA_PART_TYPES.FILE_WRITTEN]: FileWrittenData;
  [DATA_PART_TYPES.COMMAND_OUTPUT]: CommandOutputData;
  [DATA_PART_TYPES.PREVIEW_URL]: PreviewUrlData;
};

/**
 * Legacy alias for backwards compatibility.
 * @deprecated Use DataPartPayload instead
 */
export type DataPart = DataPartPayload;

// ============================================================================
// Schema Map for Runtime Validation
// ============================================================================

/**
 * Maps data part type keys to their zod schemas.
 * Use this for runtime validation of incoming data.
 */
export const DataPartSchemas = {
  [DATA_PART_TYPES.AGENT_STATUS]: AgentStatusSchema,
  [DATA_PART_TYPES.SANDBOX_STATUS]: SandboxStatusSchema,
  [DATA_PART_TYPES.FILE_WRITTEN]: FileWrittenSchema,
  [DATA_PART_TYPES.COMMAND_OUTPUT]: CommandOutputSchema,
  [DATA_PART_TYPES.PREVIEW_URL]: PreviewUrlSchema,
} as const;

/**
 * Validate and parse a data part payload.
 * Returns the parsed data or null if validation fails.
 */
export function parseDataPart<T extends DataPartType>(
  type: T,
  data: unknown
): DataPartPayload[T] | null {
  const schema = DataPartSchemas[type];
  const result = schema.safeParse(data);
  return result.success ? (result.data as DataPartPayload[T]) : null;
}

// ============================================================================
// UI Data Part Type (with "data-" prefix)
// ============================================================================

/**
 * UI data part types have a "data-" prefix.
 * Use this for routing data parts in the UI.
 */
export const UI_DATA_PART_TYPES = {
  AGENT_STATUS: `data-${DATA_PART_TYPES.AGENT_STATUS}`,
  SANDBOX_STATUS: `data-${DATA_PART_TYPES.SANDBOX_STATUS}`,
  FILE_WRITTEN: `data-${DATA_PART_TYPES.FILE_WRITTEN}`,
  COMMAND_OUTPUT: `data-${DATA_PART_TYPES.COMMAND_OUTPUT}`,
  PREVIEW_URL: `data-${DATA_PART_TYPES.PREVIEW_URL}`,
} as const;

export type UIDataPartType = (typeof UI_DATA_PART_TYPES)[keyof typeof UI_DATA_PART_TYPES];

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
export type ChatMessage = UIMessage<MessageMetadata, DataPartPayload>;

/**
 * Data UI Part with our custom data types.
 */
export type ChatDataPart = DataUIPart<DataPartPayload>;

// Re-export for convenience
export type { UIMessage, DataUIPart } from "ai";
