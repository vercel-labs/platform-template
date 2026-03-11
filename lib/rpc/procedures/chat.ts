import { os } from '@orpc/server';
import { Sandbox } from '@vercel/sandbox';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { Result } from 'better-result';
import {
  getAgent,
  isValidAgent,
  getDefaultAgent,
  SANDBOX_TIMEOUT_MS,
} from '@/lib/agents';
import {
  isValidTemplate,
  getTemplate,
  DEFAULT_TEMPLATE_ID,
  type TemplateId,
} from '@/lib/templates';
import { createProxySession } from '@/lib/redis';
import { events } from '@/lib/types';
import { setupSandbox } from '@/lib/sandbox/setup';
import { SandboxError, errorMessage } from '@/lib/errors';
import type {
  SandboxContext,
  ProxyConfig,
  StreamChunk,
} from '@/lib/agents/types';
import {
  saveSandboxSession,
  getSandboxSession,
  type ChatMessage,
  type MessagePart,
} from '@/lib/chat-history';
import { createOrchestratorStream } from '@/lib/agents/orchestrator-agent';

const PROXY_BASE_URL =
  process.env.PROXY_BASE_URL ||
  (process.env.NODE_ENV === 'development'
    ? 'http://localhost:3000/api/ai/proxy'
    : undefined);

if (!PROXY_BASE_URL) {
  throw new Error(
    'PROXY_BASE_URL environment variable is required in production',
  );
}

/**
 * Accumulates stream chunks into a ChatMessage structure.
 * Used to build the final message for persistence.
 */
class MessageAccumulator {
  private userMessage: ChatMessage | null = null;
  private assistantMessage: ChatMessage | null = null;
  // Tracks insertion order of parts: text content inline, tools by id reference
  private partsOrder: Array<{ type: 'text'; content: string } | { type: 'tool'; id: string }> = [];
  private tools: Map<
    string,
    { name: string; input: string; output?: string; isError?: boolean }
  > = new Map();
  private previewUrl: string | undefined;
  private agentSessionId: string | undefined;

  setUserMessage(prompt: string): void {
    this.userMessage = {
      id: nanoid(),
      role: 'user',
      parts: [{ type: 'text', content: prompt }],
    };
  }

  processChunk(chunk: StreamChunk): void {
    switch (chunk.type) {
      case 'message-start':
        this.assistantMessage = {
          id: chunk.id,
          role: 'assistant',
          parts: [],
        };
        if (chunk.sessionId) {
          this.agentSessionId = chunk.sessionId;
        }
        break;

      case 'text-delta': {
        const last = this.partsOrder[this.partsOrder.length - 1];
        if (last?.type === 'text') {
          last.content += chunk.text;
        } else {
          this.partsOrder.push({ type: 'text', content: chunk.text });
        }
        break;
      }

      case 'tool-start':
        this.tools.set(chunk.toolCallId, { name: chunk.toolName, input: '' });
        this.partsOrder.push({ type: 'tool', id: chunk.toolCallId });
        break;

      case 'tool-input-delta': {
        const tool = this.tools.get(chunk.toolCallId);
        if (tool) {
          tool.input += chunk.input;
        }
        break;
      }

      case 'tool-result': {
        const tool = this.tools.get(chunk.toolCallId);
        if (tool) {
          tool.output = chunk.output;
          tool.isError = chunk.isError;
        }
        break;
      }

      case 'data':
        if (chunk.dataType === 'preview-url') {
          this.previewUrl = (chunk.data as { url: string }).url;
        }
        break;
    }
  }

  finalize(): {
    messages: ChatMessage[];
    previewUrl?: string;
    agentSessionId?: string;
  } {
    const messages: ChatMessage[] = [];

    if (this.userMessage) {
      messages.push(this.userMessage);
    }

    if (this.assistantMessage) {
      const parts: MessagePart[] = this.partsOrder.map((entry) => {
        if (entry.type === 'text') {
          return { type: 'text', content: entry.content };
        }
        const tool = this.tools.get(entry.id)!;
        return {
          type: 'tool',
          id: entry.id,
          name: tool.name,
          input: tool.input,
          output: tool.output,
          isError: tool.isError,
          state: 'done' as const,
        };
      });

      this.assistantMessage.parts = parts;
      messages.push(this.assistantMessage);
    }

    return {
      messages,
      previewUrl: this.previewUrl,
      agentSessionId: this.agentSessionId,
    };
  }
}

export const sendMessage = os
  .input(
    z.object({
      prompt: z.string().min(1),
      agentId: z.string().optional(),
      templateId: z.string().optional(),
      sandboxId: z.string().optional(),
      sessionId: z.string().optional(),
    }),
  )
  .handler(async function* ({
    input: { prompt, agentId, templateId, sandboxId, sessionId },
  }) {
    const agent =
      agentId && isValidAgent(agentId) ? getAgent(agentId) : getDefaultAgent();

    const template =
      templateId && isValidTemplate(templateId)
        ? getTemplate(templateId)
        : getTemplate(DEFAULT_TEMPLATE_ID);

    const resolvedTemplateId: TemplateId = isValidTemplate(templateId ?? '')
      ? (templateId as TemplateId)
      : DEFAULT_TEMPLATE_ID;

    // Expose template-specific port
    const devPort = template.devPort;

    // Load existing session upfront (needed for orchestrator history + persistence)
    const existingSession = sandboxId
      ? await getSandboxSession(sandboxId)
      : null;
    const history = existingSession?.messages ?? [];
    const hasSandbox = !!sandboxId;
    let toolCallId: string | null = null;

    try {
      const orchestratorResult = createOrchestratorStream({
        prompt,
        history,
        hasSandbox,
      });
      yield {
        type: 'message-start' as const,
        id: nanoid(),
        role: 'assistant' as const,
      };

      for await (const part of orchestratorResult.fullStream) {
        if (part.type === 'text-delta') {
          yield part;
        } else if (part.type === 'tool-call' && part.toolName === 'BuildApp') {
          toolCallId = part.toolCallId;
        }
      }
    } catch (error) {
      const message = errorMessage(error);
      console.error('[chat] Orchestrator error:', message);
      yield { type: 'error' as const, message, code: 'orchestrator_error' };
      return;
    }

    if (!toolCallId) {
      return;
    }

    // Sandbox path — orchestrator called BuildApp
    // Yield tool-start for the BuildApp call so the client sees it
    yield { type: 'tool-start' as const, toolCallId, toolName: 'BuildApp' };

    const sandboxResult = await Result.tryPromise({
      try: () =>
        sandboxId
          ? Sandbox.get({ sandboxId })
          : Sandbox.create({ ports: [devPort], timeout: SANDBOX_TIMEOUT_MS }),
      catch: (err) =>
        new SandboxError({ message: errorMessage(err), sandboxId }),
    });

    if (sandboxResult.isErr()) {
      const msg = sandboxResult.error.message;
      console.error('[chat] Sandbox error:', msg);
      yield { type: 'error' as const, message: msg, code: 'sandbox_error' };
      return;
    }
    const sandbox = sandboxResult.value;

    yield { type: 'sandbox-id' as const, sandboxId: sandbox.sandboxId };

    if (!sandboxId) {
      try {
        for await (const progress of setupSandbox(sandbox, {
          agentId: agent.id,
          templateId: resolvedTemplateId,
        })) {
          if (progress) {
            const status = progress.stage === 'ready' ? 'ready' : 'creating';
            yield events.sandboxStatus(
              sandbox.sandboxId,
              status,
              progress.message,
            );
          }
        }
      } catch (error) {
        const message = errorMessage(error);
        console.error('[chat] Setup failed:', message);
        yield events.sandboxStatus(
          sandbox.sandboxId,
          'error',
          undefined,
          message,
        );
        yield {
          type: 'error' as const,
          message: `Sandbox setup failed: ${message}`,
          code: 'setup_error',
        };
        return;
      }
    }

    try {
      // Yield preview URL immediately so the preview iframe loads while the agent works
      const previewUrlEvent = events.previewUrl(
        sandbox.domain(devPort),
        devPort,
      );
      yield previewUrlEvent;

      const proxySessionId = nanoid(32);
      await createProxySession(proxySessionId, {
        sandboxId: sandbox.sandboxId,
      });

      const sandboxContext: SandboxContext = {
        sandboxId: sandbox.sandboxId,
        sandbox,
        templateId: resolvedTemplateId,
      };
      const proxyConfig: ProxyConfig = {
        sessionId: proxySessionId,
        baseUrl: PROXY_BASE_URL,
      };

      // Accumulate sandbox messages for persistence
      const sandboxAccumulator = new MessageAccumulator();
      sandboxAccumulator.setUserMessage(prompt);
      sandboxAccumulator.processChunk({
        type: 'data',
        dataType: 'preview-url',
        data: previewUrlEvent.data,
      });

      // Stream all sandbox agent chunks (including tool calls) to the client
      const summaryParts: string[] = [];
      for await (const chunk of agent.execute({
        prompt,
        sandboxContext,
        sessionId,
        proxyConfig,
      })) {
        sandboxAccumulator.processChunk(chunk);
        if (chunk.type === 'text-delta') summaryParts.push(chunk.text);
        yield chunk;
      }

      // Yield tool-result for the BuildApp call to close it in the UI
      const sandboxSummary = summaryParts.join('') || 'Task completed.';
      yield {
        type: 'tool-result' as const,
        toolCallId,
        output: sandboxSummary,
      };

      // Persist the session (sandbox messages + metadata) to Redis
      const {
        messages: sandboxMessages,
        previewUrl,
        agentSessionId,
      } = sandboxAccumulator.finalize();

      const persistResult = await Result.tryPromise({
        try: () =>
          saveSandboxSession(sandbox.sandboxId, {
            messages: [...history, ...sandboxMessages],
            previewUrl: previewUrl ?? existingSession?.previewUrl,
            // Preserve deployment state across follow-up messages
            projectId: existingSession?.projectId,
            projectOwnership: existingSession?.projectOwnership,
            deploymentUrl: existingSession?.deploymentUrl,
            // Preserve agent session ID for --resume across page reloads
            agentSessionId: agentSessionId ?? existingSession?.agentSessionId,
          }),
        catch: (err) => errorMessage(err),
      });

      if (persistResult.isErr()) {
        // Log but don't fail the request if persistence fails
        console.error('[chat] Failed to persist session:', persistResult.error);
      }
    } catch (error) {
      const message = errorMessage(error);
      console.error('[chat] Unexpected error:', message, error);
      yield { type: 'error' as const, message, code: 'unexpected_error' };
    }
  });
