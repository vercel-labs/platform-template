import { streamText, smoothStream } from "ai";
import type { ModelMessage, UIMessageStreamWriter, TextUIPart } from "ai";
import type { ChatMessage } from "@/lib/types";
import type { Template } from "@/lib/templates";
import type { TemplateId } from "@/lib/templates";
import type { AgentProvider } from "@/lib/agents/types";
import type { SandboxSessionData } from "@/lib/chat-history";
import { createBuildAppTool } from "@/lib/agents/build-app-tool";

export type { BuildAppResult } from "@/lib/agents/build-app-tool";

export interface OrchestratorParams {
  prompt: string;
  history: ChatMessage[];
  writer: UIMessageStreamWriter;
  agent: AgentProvider;
  template: Template;
  templateId: TemplateId;
  existingSession?: SandboxSessionData;
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
    const textContent = msg.parts
      .filter((p): p is TextUIPart => p.type === 'text')
      .map((p) => p.text)
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
  const { prompt, history, writer, agent, template, templateId, existingSession } = params;
  const hasSandbox = !!existingSession?.sandboxId;

  return streamText({
    model: 'anthropic/claude-sonnet-4-6',
    system: buildSystemPrompt(hasSandbox),
    messages: buildModelMessages(history, prompt),
    tools: {
      BuildApp: createBuildAppTool({
        prompt,
        writer,
        agent,
        templateId,
        devPort: template.devPort,
        existingSession,
      }),
    },
    maxRetries: 1,
    experimental_transform: smoothStream({
      delayInMs: 20,
    }),
  });
}
