import type { AgentProvider } from "./types";
import { ClaudeAgentProvider } from "./claude-agent";
import { CodexAgentProvider } from "./codex-agent";

const agents: AgentProvider[] = [
  new ClaudeAgentProvider(), // Default
  new CodexAgentProvider(),
];

export function getAgent(id: string): AgentProvider {
  const agent = agents.find((a) => a.id === id);
  if (!agent) {
    throw new Error(
      `Unknown agent: ${id}. Available: ${agents.map((a) => a.id).join(", ")}`,
    );
  }
  return agent;
}

export function listAgents(): Array<{
  id: string;
  name: string;
  description: string;
  logo: string;
}> {
  return agents.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    logo: a.logo,
  }));
}

export function getDefaultAgent(): AgentProvider {
  return agents[0];
}

export function isValidAgent(id: string): boolean {
  return agents.some((a) => a.id === id);
}
