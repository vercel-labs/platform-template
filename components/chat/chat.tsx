"use client";

/**
 * Chat Component
 *
 * Main chat interface with oRPC streaming.
 * Uses a custom approach since we're streaming from agent harnesses, not direct AI models.
 */

import { useState, useCallback } from "react";
import { MessageCircle, Send, Loader2, User, Bot } from "lucide-react";
import { Panel, PanelHeader, PanelContent } from "@/components/ui/panel";
import { useSandboxStore, handleDataPart } from "@/lib/store/sandbox-store";
import type { StreamChunk } from "@/lib/agents/types";
import { cn } from "@/lib/utils";
import { MessageResponse } from "@/components/ai-elements/message";

const EXAMPLE_PROMPTS = [
  "Build a pomodoro timer with sound notifications",
  "Create a mood tracker with emoji reactions and a weekly chart",
  "Make a password generator with strength indicator",
];

// Message part types - ordered as they arrive
type MessagePart =
  | { type: "text"; content: string }
  | { type: "tool"; id: string; name: string; input: string; output?: string; isError?: boolean; state: "streaming" | "done" };

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
  const { sandboxId, sessionId, setSandbox, setSessionId } = useSandboxStore();

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || status === "streaming") return;

      // Add user message
      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", content: text }],
      };
      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setStatus("streaming");

      // Create assistant message placeholder
      const assistantId = crypto.randomUUID();
      setMessages((prev) => [...prev, { id: assistantId, role: "assistant", parts: [] }]);

      // Track current text part index for appending
      let currentTextPartIndex: number | null = null;
      // Track tool parts by ID
      const toolPartIndices = new Map<string, number>();

      try {
        const { rpc } = await import("@/lib/rpc/client");

        // Stream from oRPC
        // Pass sessionId to resume conversation if we have one
        const iterator = await rpc.chat.send({
          prompt: text,
          sandboxId: sandboxId ?? undefined,
          sessionId: sessionId ?? undefined,
        });

        // Process each chunk
        for await (const chunk of iterator) {
          // Handle sandbox ID
          if (chunk.type === "sandbox-id") {
            setSandbox(chunk.sandboxId, "ready");
            continue;
          }

          // Type assertion for StreamChunk
          const streamChunk = chunk as StreamChunk;

          // Handle different chunk types
          switch (streamChunk.type) {
            case "message-start":
              // Capture session ID for conversation memory
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
                  
                  // If the last part is text, append to it
                  if (lastPart && lastPart.type === "text") {
                    parts[parts.length - 1] = {
                      ...lastPart,
                      content: lastPart.content + streamChunk.text,
                    };
                  } else {
                    // Otherwise, create a new text part
                    parts.push({ type: "text", content: streamChunk.text });
                  }
                  
                  return { ...m, parts };
                })
              );
              break;

            case "tool-start":
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;
                  
                  const parts = [...m.parts];
                  const newIndex = parts.length;
                  toolPartIndices.set(streamChunk.toolCallId, newIndex);
                  parts.push({
                    type: "tool",
                    id: streamChunk.toolCallId,
                    name: streamChunk.toolName,
                    input: "",
                    state: "streaming",
                  });
                  
                  return { ...m, parts };
                })
              );
              break;

            case "tool-input-delta":
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;
                  
                  const parts = [...m.parts];
                  // Find the tool part by ID
                  const toolIdx = parts.findIndex(
                    (p) => p.type === "tool" && p.id === streamChunk.toolCallId
                  );
                  if (toolIdx !== -1) {
                    const tool = parts[toolIdx] as Extract<MessagePart, { type: "tool" }>;
                    parts[toolIdx] = { ...tool, input: tool.input + streamChunk.input };
                  }
                  
                  return { ...m, parts };
                })
              );
              break;

            case "tool-result":
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;
                  
                  const parts = [...m.parts];
                  const toolIdx = parts.findIndex(
                    (p) => p.type === "tool" && p.id === streamChunk.toolCallId
                  );
                  if (toolIdx !== -1) {
                    const tool = parts[toolIdx] as Extract<MessagePart, { type: "tool" }>;
                    parts[toolIdx] = {
                      ...tool,
                      output: streamChunk.output,
                      isError: streamChunk.isError,
                      state: "done",
                    };
                  }
                  
                  return { ...m, parts };
                })
              );
              break;

            case "data": {
              // Handle data parts - update store
              const dataType = `data-${streamChunk.dataType}`;
              console.log(`[chat] Received data chunk: ${dataType}`, streamChunk.data);
              const store = useSandboxStore.getState();
              handleDataPart(store, dataType, streamChunk.data);
              break;
            }

            case "error":
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;
                  const parts = [...m.parts];
                  parts.push({ type: "text", content: `\n\nError: ${streamChunk.message}` });
                  return { ...m, parts };
                })
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
          })
        );
      } finally {
        setStatus("ready");
      }
    },
    [status, sandboxId, sessionId, setSandbox, setSessionId]
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

// Message view component
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
            : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      {/* Content - parts in order */}
      <div className={cn("min-w-0 flex-1 space-y-2", isUser ? "text-right" : "text-left")}>
        {message.parts.map((part, index) => (
          <PartView key={`${message.id}-${index}`} part={part} isUser={isUser} />
        ))}
      </div>
    </div>
  );
}

// Part view component
function PartView({ part, isUser }: { part: MessagePart; isUser: boolean }) {
  if (part.type === "text") {
    if (!part.content) return null;
    
    if (isUser) {
      // User messages - simple text without markdown
      return (
        <div className="inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
          <p className="whitespace-pre-wrap">{part.content}</p>
        </div>
      );
    }
    
    // Assistant messages - render markdown with Streamdown
    return (
      <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none break-words">
        <MessageResponse>{part.content}</MessageResponse>
      </div>
    );
  }

  // Tool part
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
                : "bg-zinc-100 dark:bg-zinc-800"
            )}
          >
            {part.output}
          </pre>
        </details>
      )}
    </div>
  );
}
