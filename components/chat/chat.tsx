"use client";

import { useState, useCallback } from "react";
import { MessageCircle, Send, Loader2, User, Bot, Server } from "lucide-react";
import { Panel, PanelHeader, PanelContent } from "@/components/ui/panel";
import { useSandboxStore, handleDataPart } from "@/lib/store/sandbox-store";
import { rpc } from "@/lib/rpc/client";
import type { StreamChunk } from "@/lib/agents/types";
import { UI_DATA_PART_TYPES } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MessageResponse } from "@/components/ai-elements/message";
import { AgentSelector } from "@/components/agent-selector";

const EXAMPLE_PROMPTS = [
  "Build a pomodoro timer with sound notifications",
  "Create a mood tracker with emoji reactions and a weekly chart",
  "Make a password generator with strength indicator",
];

type MessagePart =
  | { type: "text"; content: string }
  | {
      type: "tool";
      id: string;
      name: string;
      input: string;
      output?: string;
      isError?: boolean;
      state: "streaming" | "done";
    };

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
}

interface ChatProps {
  className?: string;
}

export function Chat({ className }: ChatProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<"ready" | "streaming">("ready");
  const {
    sandboxId,
    sessionId,
    agentId,
    status: sandboxStatus,
    statusMessage,
    setSandbox,
    setSessionId,
  } = useSandboxStore();

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || status === "streaming") return;

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", content: text }],
      };
      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setStatus("streaming");

      const assistantId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", parts: [] },
      ]);

      try {
        const iterator = await rpc.chat.send({
          prompt: text,
          agentId,
          sandboxId: sandboxId ?? undefined,
          sessionId: sessionId ?? undefined,
        });

        for await (const chunk of iterator) {
          if (chunk.type === "sandbox-id") {
            setSandbox(chunk.sandboxId, "ready");
            continue;
          }

          const streamChunk = chunk as StreamChunk;

          switch (streamChunk.type) {
            case "message-start":
              if (streamChunk.sessionId) {
                setSessionId(streamChunk.sessionId);
              }
              break;

            case "text-delta":
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;

                  const parts = [...m.parts];
                  const lastPart = parts[parts.length - 1];

                  if (lastPart && lastPart.type === "text") {
                    parts[parts.length - 1] = {
                      ...lastPart,
                      content: lastPart.content + streamChunk.text,
                    };
                  } else {
                    parts.push({ type: "text", content: streamChunk.text });
                  }

                  return { ...m, parts };
                }),
              );
              break;

            case "tool-start":
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;

                  const parts = [...m.parts];
                  parts.push({
                    type: "tool",
                    id: streamChunk.toolCallId,
                    name: streamChunk.toolName,
                    input: "",
                    state: "streaming",
                  });

                  return { ...m, parts };
                }),
              );
              break;

            case "tool-input-delta":
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;

                  const parts = [...m.parts];
                  const toolIdx = parts.findIndex(
                    (p) => p.type === "tool" && p.id === streamChunk.toolCallId,
                  );
                  if (toolIdx !== -1) {
                    const tool = parts[toolIdx] as Extract<
                      MessagePart,
                      { type: "tool" }
                    >;
                    parts[toolIdx] = {
                      ...tool,
                      input: tool.input + streamChunk.input,
                    };
                  }

                  return { ...m, parts };
                }),
              );
              break;

            case "tool-result":
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;

                  const parts = [...m.parts];
                  const toolIdx = parts.findIndex(
                    (p) => p.type === "tool" && p.id === streamChunk.toolCallId,
                  );
                  if (toolIdx !== -1) {
                    const tool = parts[toolIdx] as Extract<
                      MessagePart,
                      { type: "tool" }
                    >;
                    parts[toolIdx] = {
                      ...tool,
                      output: streamChunk.output,
                      isError: streamChunk.isError,
                      state: "done",
                    };
                  }

                  return { ...m, parts };
                }),
              );
              break;

            case "data": {
              const dataType =
                `data-${streamChunk.dataType}` as (typeof UI_DATA_PART_TYPES)[keyof typeof UI_DATA_PART_TYPES];
              const store = useSandboxStore.getState();
              handleDataPart(store, dataType, streamChunk.data);
              break;
            }

            case "error":
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;
                  const parts = [...m.parts];
                  parts.push({
                    type: "text",
                    content: `\n\nError: ${streamChunk.message}`,
                  });
                  return { ...m, parts };
                }),
              );
              break;
          }
        }
      } catch (error) {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantId) return m;
            const parts = [...m.parts];
            parts.push({
              type: "text",
              content: `Error: ${error instanceof Error ? error.message : String(error)}`,
            });
            return { ...m, parts };
          }),
        );
      } finally {
        setStatus("ready");
      }
    },
    [status, sandboxId, sessionId, agentId, setSandbox, setSessionId],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const isStreaming = status === "streaming";

  return (
    <Panel className={cn("flex flex-col", className)}>
      <PanelHeader>
        <div className="flex items-center gap-2 font-mono text-sm font-semibold uppercase">
          <MessageCircle className="h-4 w-4" />
          Chat
        </div>
        <div className="font-mono text-xs text-zinc-500">[{status}]</div>
      </PanelHeader>

      {/* Messages or Empty State */}
      {messages.length === 0 ? (
        <PanelContent className="flex flex-col items-center justify-center">
          <p className="mb-4 font-mono text-sm text-zinc-500">
            Try one of these prompts:
          </p>
          <ul className="space-y-2">
            {EXAMPLE_PROMPTS.map((prompt) => (
              <li key={prompt}>
                <button
                  type="button"
                  className="w-full rounded-md border border-dashed border-zinc-300 px-4 py-2 text-left font-mono text-sm transition-colors hover:border-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:bg-zinc-900"
                  onClick={() => sendMessage(prompt)}
                  disabled={isStreaming}
                >
                  {prompt}
                </button>
              </li>
            ))}
          </ul>
        </PanelContent>
      ) : (
        <PanelContent className="space-y-4">
          {messages.map((message) => (
            <MessageView key={message.id} message={message} />
          ))}
          {/* Sandbox setup indicator */}
          {(sandboxStatus === "creating" || sandboxStatus === "warming") && (
            <div className="flex items-center gap-3 rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-900 dark:bg-yellow-950">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900">
                <Server className="h-4 w-4 animate-pulse text-yellow-600 dark:text-yellow-400" />
              </div>
              <div className="flex-1">
                <p className="font-mono text-sm font-medium text-yellow-800 dark:text-yellow-200">
                  {statusMessage || "Setting up sandbox..."}
                </p>
                <p className="font-mono text-xs text-yellow-600 dark:text-yellow-400">
                  Preparing your development environment
                </p>
              </div>
              <Loader2 className="h-4 w-4 animate-spin text-yellow-600 dark:text-yellow-400" />
            </div>
          )}
        </PanelContent>
      )}

      {/* Input */}
      <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            disabled={isStreaming}
            rows={1}
            className="flex-1 resize-none rounded-md border border-zinc-300 bg-transparent px-3 py-2 font-mono text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:focus:border-zinc-500"
          />
          <AgentSelector disabled={isStreaming} />
          <button
            type="button"
            onClick={() => sendMessage(input)}
            disabled={isStreaming || !input.trim()}
            className="flex h-10 w-10 items-center justify-center rounded-md bg-zinc-900 text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </Panel>
  );
}

function MessageView({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser
            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100",
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      {/* Content - parts in order */}
      <div
        className={cn(
          "min-w-0 flex-1 space-y-2",
          isUser ? "text-right" : "text-left",
        )}
      >
        {message.parts.map((part, index) => (
          <PartView
            key={`${message.id}-${index}`}
            part={part}
            isUser={isUser}
          />
        ))}
      </div>
    </div>
  );
}

function PartView({ part, isUser }: { part: MessagePart; isUser: boolean }) {
  if (part.type === "text") {
    if (!part.content) return null;

    if (isUser) {
      return (
        <div className="inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
          <p className="whitespace-pre-wrap">{part.content}</p>
        </div>
      );
    }

    return (
      <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none break-words">
        <MessageResponse>{part.content}</MessageResponse>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-xs font-semibold uppercase text-zinc-500">
          Tool: {part.name.replace("mcp__sandbox__", "")}
        </span>
        {part.state === "streaming" && (
          <span className="text-xs text-yellow-500">Running...</span>
        )}
        {part.state === "done" && !part.isError && (
          <span className="text-xs text-green-500">Done</span>
        )}
        {part.isError && <span className="text-xs text-red-500">Error</span>}
      </div>

      {part.input && (
        <details className="mb-2">
          <summary className="cursor-pointer font-mono text-xs text-zinc-400">
            Input
          </summary>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-zinc-100 p-2 font-mono text-xs dark:bg-zinc-800">
            {part.input}
          </pre>
        </details>
      )}

      {part.output && (
        <details open={part.isError}>
          <summary className="cursor-pointer font-mono text-xs text-zinc-400">
            Output
          </summary>
          <pre
            className={cn(
              "mt-1 max-h-40 overflow-x-auto whitespace-pre-wrap break-all rounded p-2 font-mono text-xs",
              part.isError
                ? "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400"
                : "bg-zinc-100 dark:bg-zinc-800",
            )}
          >
            {part.output}
          </pre>
        </details>
      )}
    </div>
  );
}
