/**
 * Agents Module
 *
 * Exports the unified agent interface and implementations.
 */

// Types
export type {
  AgentProvider,
  ExecuteParams,
  SandboxContext,
  StreamChunk,
  DataPartType,
  DataPartPayload,
} from "./types";

export {
  isTextDelta,
  isToolStart,
  isToolResult,
  isDataChunk,
  isMessageEnd,
  isError,
} from "./types";

// Stream utilities for AI SDK integration
export {
  createAgentStream,
  toUIMessageChunk,
  type AgentDataTypes,
} from "./stream";

// Registry
export {
  getAgent,
  listAgents,
  getDefaultAgent,
  isValidAgent,
} from "./registry";

// Providers
export { ClaudeAgentProvider, claudeAgent } from "./claude-agent";
