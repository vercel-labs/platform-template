import { Sandbox } from "@vercel/sandbox";
import { tool, generateId } from "ai";
import type { UIMessageStreamWriter } from "ai";
import { nanoid } from "nanoid";
import { z } from "zod";
import { Result } from "better-result";
import { SANDBOX_TIMEOUT_MS } from "@/lib/agents/constants";
import { createProxySession } from "@/lib/redis";
import { DATA_PART_TYPES } from "@/lib/types";
import { setupSandbox } from "@/lib/sandbox/setup";
import { SandboxError, errorMessage } from "@/lib/errors";
import type {
  SandboxContext,
  ProxyConfig,
  StreamChunk,
  AgentProvider,
} from "@/lib/agents/types";
import type { TemplateId } from "@/lib/templates";
import type { SandboxSessionData } from "@/lib/chat-history";

const PROXY_BASE_URL =
  process.env.PROXY_BASE_URL ||
  (process.env.NODE_ENV === "development"
    ? "http://localhost:3000/api/ai/proxy"
    : undefined);

if (!PROXY_BASE_URL) {
  throw new Error(
    "PROXY_BASE_URL environment variable is required in production",
  );
}

export interface BuildAppResult {
  sandboxId?: string;
  previewUrl?: string;
  agentSessionId?: string;
}

export interface BuildAppToolParams {
  prompt: string;
  writer: UIMessageStreamWriter;
  agent: AgentProvider;
  templateId: TemplateId;
  devPort: number;
  existingSession?: SandboxSessionData;
}

/**
 * Creates the BuildApp tool with an execute callback closed over the given params.
 */
export function createBuildAppTool(params: BuildAppToolParams) {
  const { prompt, writer, agent, templateId, devPort, existingSession } =
    params;

  return tool({
    description:
      "Write, edit, or run code in the sandbox. Use for any task that requires file changes, commands, or builds.",
    inputSchema: z.object({}),
    async execute() {
      const existingSandboxId = existingSession?.sandboxId;

      // Create or reconnect sandbox
      const sandboxResult = await Result.tryPromise({
        try: () =>
          existingSandboxId
            ? Sandbox.get({ sandboxId: existingSandboxId })
            : Sandbox.create({
                ports: [devPort],
                timeout: SANDBOX_TIMEOUT_MS,
              }),
        catch: (err) =>
          new SandboxError({
            message: errorMessage(err),
            sandboxId: existingSandboxId,
          }),
      });

      if (sandboxResult.isErr()) {
        const msg = sandboxResult.error.message;
        console.error("[chat] Sandbox error:", msg);
        throw new Error(msg);
      }

      const sandbox = sandboxResult.value;

      // Emit sandbox status
      writer.write({
        type: `data-${DATA_PART_TYPES.SANDBOX_STATUS}`,
        data: {
          sandboxId: sandbox.sandboxId,
          status: "ready",
        },
      });

      // Setup sandbox if new
      if (!existingSandboxId) {
        try {
          for await (const progress of setupSandbox(sandbox, {
            agentId: agent.id,
            templateId,
          })) {
            if (progress) {
              const status =
                progress.stage === "ready" ? "ready" : "creating";
              writer.write({
                type: `data-${DATA_PART_TYPES.SANDBOX_STATUS}`,
                data: {
                  sandboxId: sandbox.sandboxId,
                  status,
                  message: progress.message,
                },
              });
            }
          }
        } catch (error) {
          const message = errorMessage(error);
          console.error("[chat] Setup failed:", message);
          writer.write({
            type: `data-${DATA_PART_TYPES.SANDBOX_STATUS}`,
            data: {
              sandboxId: sandbox.sandboxId,
              status: "error",
              error: message,
            },
          });
          throw new Error(`Sandbox setup failed: ${message}`);
        }
      }

      // Emit preview URL
      const previewUrl = sandbox.domain(devPort);
      writer.write({
        type: `data-${DATA_PART_TYPES.PREVIEW_URL}`,
        data: { url: previewUrl, port: devPort },
      });

      // Create proxy session
      const proxySessionId = nanoid(32);
      await createProxySession(proxySessionId, {
        sandboxId: sandbox.sandboxId,
      });

      const sandboxContext: SandboxContext = {
        sandboxId: sandbox.sandboxId,
        sandbox,
        templateId,
      };
      const proxyConfig: ProxyConfig = {
        sessionId: proxySessionId,
        baseUrl: PROXY_BASE_URL!,
      };

      // Stream sandbox agent chunks
      const summaryParts: string[] = [];
      let textPartId: string | null = null;
      let agentSessionId: string | undefined = existingSession?.agentSessionId;

      for await (const chunk of agent.execute({
        prompt,
        sandboxContext,
        sessionId: existingSession?.agentSessionId,
        proxyConfig,
      })) {
        // Capture session ID from the agent's message-start chunk
        if (chunk.type === "message-start" && chunk.sessionId) {
          agentSessionId = chunk.sessionId;
        }
        textPartId = mapStreamChunk(writer, chunk, summaryParts, textPartId);
      }

      // End any open text part
      if (textPartId) {
        writer.write({ type: "text-end", id: textPartId });
      }

      const summary = summaryParts.join("") || "Task completed.";

      return {
        sandboxId: sandbox.sandboxId,
        previewUrl,
        agentSessionId,
        summary,
      } satisfies BuildAppResult & { summary: string };
    },
  });
}

/**
 * Maps a sandbox agent StreamChunk to AI SDK UI message stream chunks.
 * Returns the current text part ID (for tracking open text-start/text-end pairs).
 */
function mapStreamChunk(
  writer: UIMessageStreamWriter,
  chunk: StreamChunk,
  summaryParts: string[],
  textPartId: string | null,
): string | null {
  switch (chunk.type) {
    case "text-delta": {
      if (!textPartId) {
        textPartId = generateId();
        writer.write({ type: "text-start", id: textPartId });
      }
      writer.write({ type: "text-delta", delta: chunk.text, id: textPartId });
      summaryParts.push(chunk.text);
      return textPartId;
    }

    case "tool-start":
      if (textPartId) {
        writer.write({ type: "text-end", id: textPartId });
        textPartId = null;
      }
      writer.write({
        type: "tool-input-start",
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
      });
      return textPartId;

    case "tool-input-delta":
      writer.write({
        type: "tool-input-delta",
        toolCallId: chunk.toolCallId,
        inputTextDelta: chunk.input,
      });
      return textPartId;

    case "tool-result":
      writer.write({
        type: "tool-output-available",
        toolCallId: chunk.toolCallId,
        output: chunk.output,
      });
      return textPartId;

    case "data": {
      const dataType = `data-${chunk.dataType}`;
      writer.write({
        type: dataType,
        data: chunk.data,
      } as Parameters<typeof writer.write>[0]);
      return textPartId;
    }

    case "message-start":
    case "message-end":
    case "reasoning-delta":
    case "error":
      return textPartId;

    default:
      return textPartId;
  }
}
