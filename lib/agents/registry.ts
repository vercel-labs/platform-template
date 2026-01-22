/**
 * Agent Registry
 *
 * Central registry for all agent providers.
 * All agents implement the same interface - execute() yields StreamChunk.
 */

import type { AgentProvider } from "./types";
import { ClaudeAgentProvider } from "./claude-agent";

// ============================================================================
// Registry
// ============================================================================

// All agents implement the same interface
const agents: AgentProvider[] = [
  new ClaudeAgentProvider(), // Default
  // Future: CodexAgentProvider, OpenCodeAgentProvider
];

/**
 * Get an agent provider by ID.
 * Throws if the agent is not found.
 */
export function getAgent(id: string): AgentProvider {
  const agent = agents.find((a) => a.id === id);
  if (!agent) {
    throw new Error(`Unknown agent: ${id}. Available: ${agents.map((a) => a.id).join(", ")}`);
  }
  return agent;
}

/**
 * List all available agents (for UI dropdowns, etc.)
 */
export function listAgents(): Array<{ id: string; name: string; description?: string }> {
  return agents.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
  }));
}

/**
 * Get the default agent provider.
 */
export function getDefaultAgent(): AgentProvider {
  return agents[0];
}

/**
 * Check if an agent ID is valid.
 */
export function isValidAgent(id: string): boolean {
  return agents.some((a) => a.id === id);
}

// Re-export types for convenience
export type { AgentProvider, StreamChunk, ExecuteParams, SandboxContext } from "./types";
