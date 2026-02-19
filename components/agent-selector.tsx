"use client";

import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSandboxStore } from "@/lib/store/sandbox-store";
import { listAgents } from "@/lib/agents";
import { cn } from "@/lib/utils";

const AGENTS = listAgents();

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
        <span className="grid text-left">
          {AGENTS.map((agent) => (
            <span
              key={agent.id}
              className={cn(
                "col-start-1 row-start-1",
                agent.id !== selectedAgent.id && "invisible",
              )}
            >
              {agent.name}
            </span>
          ))}
        </span>
        <ChevronDown className="h-4 w-4 text-zinc-500" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {AGENTS.map((agent) => (
          <DropdownMenuItem
            key={agent.id}
            onClick={() => setAgentId(agent.id)}
            className={cn(
              "flex items-center gap-2 cursor-pointer",
              agent.id === agentId && "bg-zinc-100 dark:bg-zinc-800",
            )}
          >
            <AgentLogo provider={agent.logo} />
            <span className="font-medium">{agent.name}</span>
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
  const isLocal = provider.startsWith("/");
  const src = isLocal
    ? provider
    : `https://models.dev/logos/${provider}.svg`;
  return (
    <img
      src={src}
      alt={`${provider} logo`}
      className={cn("h-4 w-4", !isLocal && "dark:invert", className)}
      width={16}
      height={16}
    />
  );
}
