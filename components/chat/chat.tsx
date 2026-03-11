'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { MessageCircle, Send, Loader2, Server } from 'lucide-react';

import { Panel, PanelHeader } from '@/components/ui/panel';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import { useSandboxStore, handleDataPart } from '@/lib/store/sandbox-store';
import { rpc } from '@/lib/rpc/client';
import type { StreamChunk } from '@/lib/agents/types';
import { UI_DATA_PART_TYPES } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool';
import type { ToolPart } from '@/components/ai-elements/tool';
import { AgentSelector } from '@/components/agent-selector';
import { TemplateSelector } from '@/components/template-selector';
import {
  usePersistedChat,
  type ChatMessage,
} from '@/lib/hooks/use-persisted-chat';

const EXAMPLE_PROMPTS = [
  'Build a pomodoro timer with sound notifications',
  'Create a mood tracker with emoji reactions and a weekly chart',
  'Make a password generator with strength indicator',
];

type MessagePart = ChatMessage['parts'][number];

interface ChatProps {
  className?: string;
  /** When true, the chat is centered on the page with no sidebar — hides internal divider borders */
  standalone?: boolean;
}

export function Chat({ className, standalone }: ChatProps) {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'ready' | 'streaming'>('ready');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { messages, setMessages } = usePersistedChat();

  const {
    sandboxId,
    sessionId,
    agentId,
    templateId,
    status: sandboxStatus,
    statusMessage,
    setSandbox,
    setSessionId,
  } = useSandboxStore();

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || status === 'streaming') return;

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', content: text }],
      };
      setMessages((prev) => [...prev, userMessage]);
      setInput('');
      setStatus('streaming');

      const assistantId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', parts: [] },
      ]);

      try {
        const iterator = await rpc.chat.send({
          prompt: text,
          agentId,
          templateId,
          sandboxId: sandboxId ?? undefined,
          sessionId: sessionId ?? undefined,
        });

        for await (const chunk of iterator) {
          if (chunk.type === 'sandbox-id') {
            setSandbox(chunk.sandboxId, 'ready');
            continue;
          }

          const streamChunk = chunk as StreamChunk;

          switch (streamChunk.type) {
            case 'message-start':
              if (streamChunk.sessionId) {
                setSessionId(streamChunk.sessionId);
              }
              break;

            case 'text-delta':
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;

                  const parts = [...m.parts];
                  const lastPart = parts[parts.length - 1];

                  if (lastPart && lastPart.type === 'text') {
                    parts[parts.length - 1] = {
                      ...lastPart,
                      content: lastPart.content + streamChunk.text,
                    };
                  } else {
                    parts.push({ type: 'text', content: streamChunk.text });
                  }

                  return { ...m, parts };
                }),
              );
              break;

            case 'tool-start':
              if (streamChunk.toolName === 'BuildApp') {
                useSandboxStore.getState().setIsBuildingApp(true);
              }
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;

                  const parts = [...m.parts];
                  parts.push({
                    type: 'tool',
                    id: streamChunk.toolCallId,
                    name: streamChunk.toolName,
                    input: '',
                    state: 'streaming',
                  });

                  return { ...m, parts };
                }),
              );
              break;

            case 'tool-input-delta':
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;

                  const parts = [...m.parts];
                  const toolIdx = parts.findIndex(
                    (p) => p.type === 'tool' && p.id === streamChunk.toolCallId,
                  );
                  if (toolIdx !== -1) {
                    const tool = parts[toolIdx] as Extract<
                      MessagePart,
                      { type: 'tool' }
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

            case 'tool-result':
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;

                  const parts = [...m.parts];
                  const toolIdx = parts.findIndex(
                    (p) => p.type === 'tool' && p.id === streamChunk.toolCallId,
                  );
                  if (toolIdx !== -1) {
                    const tool = parts[toolIdx] as Extract<
                      MessagePart,
                      { type: 'tool' }
                    >;
                    parts[toolIdx] = {
                      ...tool,
                      output: streamChunk.output,
                      isError: streamChunk.isError,
                      state: 'done',
                    };
                  }

                  return { ...m, parts };
                }),
              );
              break;

            case 'data': {
              const dataType =
                `data-${streamChunk.dataType}` as (typeof UI_DATA_PART_TYPES)[keyof typeof UI_DATA_PART_TYPES];
              const store = useSandboxStore.getState();
              handleDataPart(store, dataType, streamChunk.data);
              break;
            }

            case 'error':
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m;
                  const parts = [...m.parts];
                  parts.push({
                    type: 'text',
                    content: `\n\nError: ${streamChunk.message}`,
                  });
                  return { ...m, parts };
                }),
              );
              break;
          }
        }
      } catch (error) {
        console.error('[chat] RPC error:', error);
        const errorDetail =
          error instanceof Error
            ? `${error.message}${(error as { code?: string }).code ? ` (code: ${(error as { code?: string }).code})` : ''}${error.cause ? ` | cause: ${error.cause}` : ''}`
            : String(error);
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantId) return m;
            const parts = [...m.parts];
            parts.push({
              type: 'text',
              content: `Error: ${errorDetail}`,
            });
            return { ...m, parts };
          }),
        );
      } finally {
        setStatus('ready');
      }
    },
    [
      status,
      sandboxId,
      sessionId,
      agentId,
      templateId,
      setSandbox,
      setSessionId,
    ],
  );

  // Auto-resize textarea as content changes
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const isStreaming = status === 'streaming';
  // Disable selectors once chat has started (has messages)
  const hasStartedChat = messages.length > 0;

  return (
    <Panel className={cn('flex min-h-0 flex-col', className)}>
      <div
        className={cn(
          'overflow-hidden transition-all duration-500 ease-in-out',
          standalone ? 'max-h-0 opacity-0' : 'max-h-12 opacity-100',
        )}
      >
        <PanelHeader>
          <div className="flex items-center gap-2 font-mono text-sm font-semibold uppercase">
            <MessageCircle className="h-4 w-4" />
            Chat
          </div>
        </PanelHeader>
      </div>

      {/* Messages or Empty State */}
      <Conversation>
        <ConversationContent className="mx-auto w-full max-w-2xl">
          {messages.length === 0 ? (
            <ConversationEmptyState>
              <p className="mb-4 text-center text-sm text-zinc-500">
                Try one of these prompts:
              </p>
              <ul className="w-full max-w-md space-y-2">
                {EXAMPLE_PROMPTS.map((prompt) => (
                  <li key={prompt}>
                    <button
                      type="button"
                      className="w-full rounded-md border border-dashed border-zinc-300 px-4 py-3 text-left text-sm transition-colors hover:border-zinc-500 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:bg-zinc-900"
                      onClick={() => sendMessage(prompt)}
                      disabled={isStreaming}
                    >
                      {prompt}
                    </button>
                  </li>
                ))}
              </ul>
            </ConversationEmptyState>
          ) : (
            <>
              {messages.map((message) => (
                <MessageView key={message.id} message={message} />
              ))}
              {/* Sandbox setup indicator */}
              {(sandboxStatus === 'creating' ||
                sandboxStatus === 'warming') && (
                <div className="-mt-6 ml-11 flex items-center gap-3 rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-900 dark:bg-yellow-950">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900">
                    <Server className="h-4 w-4 animate-pulse text-yellow-600 dark:text-yellow-400" />
                  </div>
                  <div className="flex-1">
                    <p className="font-mono text-xs font-medium text-yellow-800 dark:text-yellow-200">
                      {statusMessage || 'Setting up sandbox...'}
                    </p>
                    <p className="font-mono text-xs text-yellow-600 dark:text-yellow-400">
                      Preparing your development environment
                    </p>
                  </div>
                  <Loader2 className="h-4 w-4 animate-spin text-yellow-600 dark:text-yellow-400" />
                </div>
              )}
            </>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Input */}
      <div className="p-3 sm:p-4">
        <div
          className={cn(
            'mx-auto flex w-full max-w-2xl flex-col gap-2 transition-[border-color,padding] duration-500 ease-in-out',
            standalone
              ? 'border-transparent pt-0'
              : 'border-t border-zinc-200 pt-3 dark:border-zinc-800',
          )}
        >
          {!hasStartedChat && (
            <div className="flex flex-wrap gap-2">
              <TemplateSelector disabled={isStreaming} />
              <AgentSelector disabled={isStreaming} />
            </div>
          )}
          <div className="flex gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              disabled={isStreaming}
              rows={3}
              className="flex-1 resize-none rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-400 focus:border-zinc-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:focus:border-zinc-500"
            />
            <button
              type="button"
              onClick={() => sendMessage(input)}
              disabled={isStreaming || !input.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {isStreaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function ThinkingIndicator() {
  return (
    <div className="prose prose-zinc dark:prose-invert max-w-none break-words text-sm">
      <span className="animate-shimmer bg-[length:200%_100%] bg-gradient-to-r from-zinc-300 via-zinc-100 to-zinc-300 bg-clip-text text-transparent dark:from-zinc-600 dark:via-zinc-400 dark:to-zinc-600">
        Thinking ...
      </span>
    </div>
  );
}

function MessageView({ message }: { message: ChatMessage }) {
  const from = message.role === 'user' ? 'user' : 'assistant';

  return (
    <Message from={from}>
      <MessageContent from={from}>
        {message.parts.length === 0 && from === 'assistant' ? (
          <ThinkingIndicator />
        ) : (
          message.parts.map((part: MessagePart, index: number) => (
            <PartView
              key={`${message.id}-${index}`}
              part={part}
              isUser={from === 'user'}
            />
          ))
        )}
      </MessageContent>
    </Message>
  );
}

function PartView({ part, isUser }: { part: MessagePart; isUser: boolean }) {
  if (part.type === 'text') {
    if (!part.content) return null;

    if (isUser) {
      return (
        <div className="inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
          <p className="whitespace-pre-wrap">{part.content}</p>
        </div>
      );
    }

    return (
      <div className="prose prose-zinc dark:prose-invert max-w-none break-words text-sm">
        <MessageResponse>{part.content}</MessageResponse>
      </div>
    );
  }

  const toolState: ToolPart['state'] =
    part.state === 'streaming'
      ? 'input-streaming'
      : part.isError
        ? 'output-error'
        : 'output-available';

  let parsedInput = null;
  try {
    parsedInput = typeof part.input === "string" ? JSON.parse(part.input) : part.input;
  } catch {
    parsedInput = part.input;
  }

  return (
    <Tool>
      <ToolHeader
        type="dynamic-tool"
        toolName={part.name.replace('mcp__sandbox__', '')}
        state={toolState}
      />
      <ToolContent>
        {<ToolInput input={parsedInput} />}
        <ToolOutput
          output={part.isError ? undefined : part.output}
          errorText={part.isError ? part.output : undefined}
        />
      </ToolContent>
    </Tool>
  );
}
