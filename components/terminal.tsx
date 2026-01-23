"use client";

/**
 * Terminal Component
 *
 * Displays command output from the sandbox.
 */

import { useEffect, useRef } from "react";
import { Terminal as TerminalIcon, Trash2 } from "lucide-react";
import { Panel, PanelHeader, PanelContent } from "@/components/ui/panel";
import { useSandboxStore } from "@/lib/store/sandbox-store";
import { cn } from "@/lib/utils";
import Ansi from "ansi-to-react";

interface TerminalProps {
  className?: string;
}

export function Terminal({ className }: TerminalProps) {
  const { commands } = useSandboxStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [commands]);

  // Flatten all logs with command context
  const allOutput = commands.flatMap((cmd) => {
    const header = `$ ${cmd.command}${cmd.args?.length ? ` ${cmd.args.join(" ")}` : ""}\n`;
    const logs = cmd.logs.map((log) => ({
      data: log.data,
      stream: log.stream,
    }));
    const footer =
      cmd.exitCode !== undefined ? `\nExit code: ${cmd.exitCode}\n` : "";
    return [
      { data: header, stream: "stdout" as const },
      ...logs,
      ...(footer ? [{ data: footer, stream: "stdout" as const }] : []),
    ];
  });

  return (
    <Panel className={cn("flex flex-col", className)}>
      <PanelHeader>
        <div className="flex items-center gap-2 font-mono text-sm font-semibold uppercase">
          <TerminalIcon className="h-4 w-4" />
          Terminal
        </div>
        <div className="font-mono text-xs text-zinc-500">
          {commands.length} commands
        </div>
      </PanelHeader>

      <div
        ref={scrollRef}
        className="flex-1 overflow-auto bg-zinc-950 p-4 font-mono text-sm text-zinc-100"
      >
        {allOutput.length === 0 ? (
          <p className="text-zinc-500">No output yet.</p>
        ) : (
          <pre className="whitespace-pre-wrap break-words">
            {allOutput.map((line, index) => (
              <span
                key={index}
                className={cn(
                  line.stream === "stderr" && "text-red-400"
                )}
              >
                <Ansi>{line.data}</Ansi>
              </span>
            ))}
          </pre>
        )}
      </div>
    </Panel>
  );
}
