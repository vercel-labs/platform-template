'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Loader2, MessageCircle, Server } from 'lucide-react';
import { useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  type UIMessage,
  isToolUIPart,
  getToolName,
} from 'ai';
import {
  PromptInput,
  PromptInputBody,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputSubmit,
} from '@/components/ai-elements/prompt-input';

import { Panel, PanelHeader } from '@/components/ui/panel';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  useChatId,
  useSessionId,
  useAgentId,
  useTemplateId,
  useSandboxStatus,
  useStatusMessage,
  useApplyStreamData,
} from '@/lib/store/sandbox-store';
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
import type { ChatMessage } from '@/lib/types';

const EXAMPLE_PROMPTS = [
  'Build a pomodoro timer with sound notifications',
  'Create a mood tracker with emoji reactions and a weekly chart',
  'Make a password generator with strength indicator',
];

// ---------------------------------------------------------------------------
// Chat component
// ---------------------------------------------------------------------------

interface ChatProps {
  className?: string;
  /** When true, the chat is centered on the page with no sidebar — hides internal divider borders */
  standalone?: boolean;
  /** Messages loaded server-side for existing chats */
  initialMessages?: ChatMessage[];
}

export function Chat({
  className,
  standalone,
  initialMessages,
}: ChatProps) {
  const chatId = useChatId()!;
  const sessionId = useSessionId();
  const agentId = useAgentId();
  const templateId = useTemplateId();
  const sandboxStatus = useSandboxStatus();
  const statusMessage = useStatusMessage();
  const applyStreamData = useApplyStreamData();

  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/chat' }),
    [],
  );

  const { messages, sendMessage, status, stop } = useChat({
    id: chatId,
    messages: initialMessages,
    transport,
    onData: (dataPart) => {
      applyStreamData(dataPart.type, dataPart.data);
    },
  });

  // Update URL when a new chat starts (i.e. we're on "/" not "/chat/...").
  // Use replaceState to avoid a Next.js server navigation that would remount.
  const hasUpdatedUrl = useRef(false);
  useEffect(() => {
    if (
      !hasUpdatedUrl.current &&
      !window.location.pathname.startsWith('/chat/') &&
      messages.length > 0
    ) {
      window.history.replaceState(null, '', `/chat/${chatId}`);
      hasUpdatedUrl.current = true;
    }
  }, [messages.length, chatId]);

  // -------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------

  const isStreaming = status === 'streaming' || status === 'submitted';
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
                      onClick={() =>
                        sendMessage(
                          { text: prompt },
                          {
                            body: {
                              chatId,
                              agentId,
                              templateId,
                              sessionId: sessionId ?? undefined,
                            },
                          },
                        )
                      }
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
            standalone ? 'border-transparent pt-0' : 'pt-3',
          )}
        >
          {!hasStartedChat && (
            <div className="flex flex-wrap gap-2">
              <TemplateSelector disabled={isStreaming} />
              <AgentSelector disabled={isStreaming} />
            </div>
          )}
          <PromptInput
            onSubmit={(msg) =>
              sendMessage(
                { text: msg.text },
                {
                  body: {
                    chatId,
                    agentId,
                    templateId,
                    sessionId: sessionId ?? undefined,
                  },
                },
              )
            }
          >
            <PromptInputBody>
              <PromptInputTextarea
                placeholder="Type your message..."
                disabled={isStreaming}
              />
            </PromptInputBody>
            <PromptInputFooter>
              <PromptInputTools />
              <PromptInputSubmit
                status={isStreaming ? 'streaming' : undefined}
                disabled={isStreaming}
                onStop={stop}
              />
            </PromptInputFooter>
          </PromptInput>
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

function MessageView({ message }: { message: UIMessage }) {
  const from = message.role === 'user' ? 'user' : 'assistant';

  return (
    <Message from={from}>
      <MessageContent from={from}>
        {message.parts.length === 0 && from === 'assistant' ? (
          <ThinkingIndicator />
        ) : (
          message.parts.map((part, index) => (
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

type UIMessagePart = UIMessage['parts'][number];

function PartView({ part, isUser }: { part: UIMessagePart; isUser: boolean }) {
  if (part.type === 'text') {
    if (!part.text) return null;

    if (isUser) {
      return (
        <div className="inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">
          <p className="whitespace-pre-wrap">{part.text}</p>
        </div>
      );
    }

    return (
      <div className="prose prose-zinc dark:prose-invert max-w-none break-words text-sm">
        <MessageResponse>{part.text}</MessageResponse>
      </div>
    );
  }

  // Handle tool invocations (static "tool-{name}" and "dynamic-tool" parts)
  if (isToolUIPart(part)) {
    const toolState: ToolPart['state'] =
      part.state === 'output-error'
        ? 'output-error'
        : part.state === 'output-available'
          ? 'output-available'
          : 'input-streaming';

    const output =
      'output' in part && part.output !== undefined
        ? typeof part.output === 'string'
          ? part.output
          : JSON.stringify(part.output)
        : undefined;

    return (
      <Tool>
        <ToolHeader
          type="dynamic-tool"
          toolName={getToolName(part).replace('mcp__sandbox__', '')}
          state={toolState}
        />
        <ToolContent>
          <ToolInput input={'input' in part ? part.input : undefined} />
          <ToolOutput
            output={part.state !== 'output-error' ? output : undefined}
            errorText={part.state === 'output-error' ? part.errorText : undefined}
          />
        </ToolContent>
      </Tool>
    );
  }

  // Skip data parts and other unknown types in rendering
  return null;
}
