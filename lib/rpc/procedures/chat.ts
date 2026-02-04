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
import type { SandboxContext, ProxyConfig } from "@/lib/agents/types";

const PROXY_BASE_URL =
  process.env.PROXY_BASE_URL ||
  (process.env.NODE_ENV === "development"
    ? "http://localhost:3000/api/ai/proxy"
    : undefined);

if (!PROXY_BASE_URL) {
  throw new Error("PROXY_BASE_URL environment variable is required in production");
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

    for await (const chunk of agent.execute({
      prompt,
      sandboxContext,
      sessionId,
      proxyConfig,
    })) {
      yield chunk;
    }

    yield events.previewUrl(sandbox.domain(devPort), devPort);
  });
