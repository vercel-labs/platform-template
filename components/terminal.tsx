"use client";

/**
 * Terminal Component
 *
 * Displays command output from the sandbox using ai-elements Terminal.
 */

import { useMemo } from "react";
import { Panel, PanelHeader } from "@/components/ui/panel";
import {
  Terminal as AITerminal,
  TerminalHeader,
  TerminalTitle,
  TerminalActions,
  TerminalCopyButton,
  TerminalContent,
  TerminalStatus,
} from "@/components/ai-elements/terminal";
import { useSandboxStore } from "@/lib/store/sandbox-store";
import { cn } from "@/lib/utils";

interface TerminalProps {
  className?: string;
}

export function Terminal({ className }: TerminalProps) {
  const { commands } = useSandboxStore();

  // Check if any command is still running (no exit code yet)
  const isStreaming = commands.some((cmd) => cmd.exitCode === undefined);

  // Build the terminal output string from all commands
  const output = useMemo(() => {
    return commands
      .map((cmd) => {
        const header = `$ ${cmd.command}${cmd.args?.length ? ` ${cmd.args.join(" ")}` : ""}\n`;
        const logs = cmd.logs.map((log) => log.data).join("");
        const footer =
          cmd.exitCode !== undefined ? `\nExit code: ${cmd.exitCode}\n` : "";
        return header + logs + footer;
      })
      .join("\n");
  }, [commands]);

  return (
    <Panel className={cn("flex flex-col", className)}>
      <AITerminal
        output={output}
        isStreaming={isStreaming}
        autoScroll={true}
        className="flex-1 border-0 rounded-none"
      >
        <TerminalHeader>
          <TerminalTitle>{commands.length} commands</TerminalTitle>
          <div className="flex items-center gap-1">
            <TerminalStatus />
            <TerminalActions>
              <TerminalCopyButton />
            </TerminalActions>
          </div>
        </TerminalHeader>
        <TerminalContent className="flex-1 max-h-none" />
      </AITerminal>
    </Panel>
  );
}
