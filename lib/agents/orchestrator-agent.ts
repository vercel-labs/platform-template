import { streamText, smoothStream, tool } from 'ai';
import type { ModelMessage } from 'ai';
import { z } from 'zod';
import type { ChatMessage } from '@/lib/chat-history';

export interface OrchestratorParams {
  prompt: string;
  history: ChatMessage[];
  hasSandbox: boolean;
}

function buildSystemPrompt(hasSandbox: boolean): string {
  const sandboxNote = hasSandbox
    ? '\nThe user already has an active app in progress. When in doubt, prefer calling BuildApp.'
    : '';

  return `You are a helpful assistant for an AI-powered app builder.

Call BuildApp when the user wants to:
- Create, build, scaffold, or generate any application, page, or component
- Modify, fix, refactor, or extend existing code
- Install packages, run commands, or change project configuration
- Do anything that requires writing or editing files

Answer directly (without calling BuildApp) when the user:
- Asks general knowledge questions ("what is React?", "how does flexbox work?")
- Asks about you or your capabilities
- Makes small talk or greetings
- Asks questions that don't require code changes

Do not write any text before calling BuildApp — call it immediately if the task requires it.${sandboxNote}`;
}

function buildModelMessages(
  history: ChatMessage[],
  prompt: string,
): ModelMessage[] {
  const messages: ModelMessage[] = [];

  for (const msg of history) {
    // Only include text parts — skip tool call history (not needed for routing)
    const textContent = msg.parts
      .filter((p): p is { type: 'text'; content: string } => p.type === 'text')
      .map((p) => p.content)
      .join('\n');

    if (!textContent) continue;

    if (msg.role === 'user') {
      messages.push({ role: 'user', content: textContent });
    } else {
      messages.push({ role: 'assistant', content: textContent });
    }
  }

  messages.push({ role: 'user', content: prompt });
  return messages;
}

export function createOrchestratorStream(params: OrchestratorParams) {
  return streamText({
    model: 'anthropic/claude-sonnet-4-6',
    system: buildSystemPrompt(params.hasSandbox),
    messages: buildModelMessages(params.history, params.prompt),
    tools: {
      BuildApp: tool({
        description:
          'Delegate to the sandbox coding agent. Call this when the user wants to build, create, modify, or fix code.',
        inputSchema: z.object({}),
      }),
    },
    maxRetries: 1,
    experimental_transform: smoothStream({
      delayInMs: 20
    }),
  });
}
