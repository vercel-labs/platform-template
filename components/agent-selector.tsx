"use client";

import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSandboxStore } from "@/lib/store/sandbox-store";
import { cn } from "@/lib/utils";

const AGENTS = [
  {
    id: "claude",
    name: "Claude",
    description: "Anthropic's Claude Code",
    logo: "anthropic",
  },
  {
    id: "codex",
    name: "Codex",
    description: "OpenAI's Codex",
    logo: "openai",
  },
] as const;

interface AgentSelectorProps {
  className?: string;
  disabled?: boolean;
}

export function AgentSelector({ className, disabled }: AgentSelectorProps) {
  const { agentId, setAgentId } = useSandboxStore();

  const selectedAgent = AGENTS.find((a) => a.id === agentId) ?? AGENTS[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={cn(
          "flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800",
          className,
        )}
      >
        <AgentLogo provider={selectedAgent.logo} />
        <span>{selectedAgent.name}</span>
        <ChevronDown className="h-4 w-4 text-zinc-500" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {AGENTS.map((agent) => (
          <DropdownMenuItem
            key={agent.id}
            onClick={() => setAgentId(agent.id)}
            className={cn(
              "flex items-center gap-3 cursor-pointer",
              agent.id === agentId && "bg-zinc-100 dark:bg-zinc-800",
            )}
          >
            <AgentLogo provider={agent.logo} className="h-5 w-5" />
            <div className="flex flex-col">
              <span className="font-medium">{agent.name}</span>
              <span className="text-xs text-zinc-500">{agent.description}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AgentLogo({
  provider,
  className,
}: {
  provider: string;
  className?: string;
}) {
  return (
    <img
      src={`https://models.dev/logos/${provider}.svg`}
      alt={`${provider} logo`}
      className={cn("h-4 w-4 dark:invert", className)}
      width={16}
      height={16}
    />
  );
}
