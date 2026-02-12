import { os } from "@orpc/server";
import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";
import { nanoid } from "nanoid";
import { Result } from "better-result";
import {
  getAgent,
  isValidAgent,
  getDefaultAgent,
  SANDBOX_TIMEOUT_MS,
} from "@/lib/agents";
import {
  isValidTemplate,
  getTemplate,
  DEFAULT_TEMPLATE_ID,
  type TemplateId,
} from "@/lib/templates";
import { createProxySession } from "@/lib/redis";
import { events } from "@/lib/types";
import { setupSandbox } from "@/lib/sandbox/setup";
import { SandboxError, SetupError, errorMessage } from "@/lib/errors";
import type {
  SandboxContext,
  ProxyConfig,
  StreamChunk,
} from "@/lib/agents/types";
import {
  saveSandboxSession,
  getSandboxSession,
  type ChatMessage,
  type MessagePart,
} from "@/lib/chat-history";

const PROXY_BASE_URL =
  process.env.PROXY_BASE_URL ||
  (process.env.NODE_ENV === "development"
    ? "http://localhost:3000/api/ai/proxy"
    : undefined);

if (!PROXY_BASE_URL) {
  throw new Error("PROXY_BASE_URL environment variable is required in production");
}

/**
 * Accumulates stream chunks into a ChatMessage structure.
 * Used to build the final message for persistence.
 */
class MessageAccumulator {
  private userMessage: ChatMessage | null = null;
  private assistantMessage: ChatMessage | null = null;
  private currentText = "";
  private tools: Map<
    string,
    { name: string; input: string; output?: string; isError?: boolean }
  > = new Map();
  private previewUrl: string | undefined;

  setUserMessage(prompt: string): void {
    this.userMessage = {
      id: nanoid(),
      role: "user",
      parts: [{ type: "text", content: prompt }],
    };
  }

  processChunk(chunk: StreamChunk): void {
    switch (chunk.type) {
      case "message-start":
        this.assistantMessage = {
          id: chunk.id,
          role: "assistant",
          parts: [],
        };
        break;

      case "text-delta":
        this.currentText += chunk.text;
        break;

      case "tool-start":
        this.tools.set(chunk.toolCallId, {
          name: chunk.toolName,
          input: "",
        });
        break;

      case "tool-input-delta": {
        const tool = this.tools.get(chunk.toolCallId);
        if (tool) {
          tool.input += chunk.input;
        }
        break;
      }

      case "tool-result": {
        const tool = this.tools.get(chunk.toolCallId);
        if (tool) {
          tool.output = chunk.output;
          tool.isError = chunk.isError;
        }
        break;
      }

      case "data":
        if (chunk.dataType === "preview-url") {
          this.previewUrl = (chunk.data as { url: string }).url;
        }
        break;
    }
  }

  finalize(): { messages: ChatMessage[]; previewUrl?: string } {
    const messages: ChatMessage[] = [];

    if (this.userMessage) {
      messages.push(this.userMessage);
    }

    if (this.assistantMessage) {
      const parts: MessagePart[] = [];

      // Add text part if there's content
      if (this.currentText) {
        parts.push({ type: "text", content: this.currentText });
      }

      // Add tool parts
      for (const [id, tool] of this.tools) {
        parts.push({
          type: "tool",
          id,
          name: tool.name,
          input: tool.input,
          output: tool.output,
          isError: tool.isError,
          state: "done",
        });
      }

      this.assistantMessage.parts = parts;
      messages.push(this.assistantMessage);
    }

    return { messages, previewUrl: this.previewUrl };
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
    const agent = agentId && isValidAgent(agentId)
      ? getAgent(agentId)
      : getDefaultAgent();

    const template = templateId && isValidTemplate(templateId)
      ? getTemplate(templateId)
      : getTemplate(DEFAULT_TEMPLATE_ID);

    const resolvedTemplateId: TemplateId = isValidTemplate(templateId ?? "")
      ? (templateId as TemplateId)
      : DEFAULT_TEMPLATE_ID;

    // Expose template-specific port
    const devPort = template.devPort;

    const sandboxResult = await Result.tryPromise({
      try: () =>
        sandboxId
          ? Sandbox.get({ sandboxId })
          : Sandbox.create({ ports: [devPort], timeout: SANDBOX_TIMEOUT_MS }),
      catch: (err) =>
        new SandboxError({ message: errorMessage(err), sandboxId }),
    });

    if (sandboxResult.isErr()) {
      throw sandboxResult.error;
    }
    const sandbox = sandboxResult.value;

    yield { type: "sandbox-id" as const, sandboxId: sandbox.sandboxId };

    if (!sandboxId) {
      try {
        for await (const progress of setupSandbox(sandbox, {
          agentId: agent.id,
          templateId: resolvedTemplateId,
        })) {
          if (progress) {
            const status = progress.stage === "ready" ? "ready" : "creating";
            yield events.sandboxStatus(
              sandbox.sandboxId,
              status,
              progress.message,
            );
          }
        }
      } catch (error) {
        const message = errorMessage(error);
        console.error("[chat] Setup failed:", message);
        yield events.sandboxStatus(
          sandbox.sandboxId,
          "error",
          undefined,
          message,
        );
        throw new SetupError({
          message: `Sandbox setup failed: ${message}`,
          step: "setup",
        });
      }
    }

    const proxySessionId = nanoid(32);
    await createProxySession(proxySessionId, { sandboxId: sandbox.sandboxId });

    const sandboxContext: SandboxContext = {
      sandboxId: sandbox.sandboxId,
      sandbox,
      templateId: resolvedTemplateId,
    };
    const proxyConfig: ProxyConfig = {
      sessionId: proxySessionId,
      baseUrl: PROXY_BASE_URL,
    };

    // Accumulate messages for persistence
    const accumulator = new MessageAccumulator();
    accumulator.setUserMessage(prompt);

    for await (const chunk of agent.execute({
      prompt,
      sandboxContext,
      sessionId,
      proxyConfig,
    })) {
      accumulator.processChunk(chunk);
      yield chunk;
    }

    // Yield preview URL
    const previewUrlEvent = events.previewUrl(sandbox.domain(devPort), devPort);
    accumulator.processChunk({
      type: "data",
      dataType: "preview-url",
      data: previewUrlEvent.data,
    });
    yield previewUrlEvent;

    // Persist the session (messages + metadata) to Redis
    const { messages: newMessages, previewUrl } = accumulator.finalize();

    // Load existing session and append new messages
    const existingSession = await getSandboxSession(sandbox.sandboxId);
    const existingMessages = existingSession?.messages ?? [];

    const persistResult = await Result.tryPromise({
      try: () =>
        saveSandboxSession(sandbox.sandboxId, {
          messages: [...existingMessages, ...newMessages],
          previewUrl: previewUrl ?? existingSession?.previewUrl,
          // Preserve deployment state across follow-up messages
          projectId: existingSession?.projectId,
          projectOwnership: existingSession?.projectOwnership,
          deploymentUrl: existingSession?.deploymentUrl,
        }),
      catch: (err) => errorMessage(err),
    });

    if (persistResult.isErr()) {
      // Log but don't fail the request if persistence fails
      console.error("[chat] Failed to persist session:", persistResult.error);
    }
  });
