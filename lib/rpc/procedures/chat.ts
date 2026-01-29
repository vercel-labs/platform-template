import { os } from "@orpc/server";
import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";
import { nanoid } from "nanoid";
import { Result } from "better-result";
import {
  getAgent,
  isValidAgent,
  getDefaultAgent,
  SANDBOX_DEV_PORT,
} from "@/lib/agents";
import { createSession } from "@/lib/redis";
import { events } from "@/lib/types";
import { setupSandbox } from "@/lib/sandbox/setup";
import { SandboxError, SetupError, errorMessage } from "@/lib/errors";
import type { SandboxContext, ProxyConfig } from "@/lib/agents/types";

const PROXY_BASE_URL =
  process.env.PROXY_BASE_URL ||
  "https://platform-template.labs.vercel.dev/api/ai/proxy";

/**
 * Send a message to an AI agent in a sandbox.
 * Creates a new sandbox if sandboxId is not provided.
 * Streams responses as they are generated.
 */
export const sendMessage = os
  .input(
    z.object({
      prompt: z.string().min(1),
      agentId: z.string().optional(),
      sandboxId: z.string().optional(),
      sessionId: z.string().optional(),
    }),
  )
  .handler(async function* ({
    input: { prompt, agentId, sandboxId, sessionId },
  }) {
    // Resolve agent (use default if not specified or invalid)
    const agent = isValidAgent(agentId ?? "")
      ? getAgent(agentId!)
      : getDefaultAgent();

    // Get or create sandbox
    const sandboxResult = await Result.tryPromise({
      try: () =>
        sandboxId
          ? Sandbox.get({ sandboxId })
          : Sandbox.create({ ports: [SANDBOX_DEV_PORT], timeout: 600_000 }),
      catch: (err) =>
        new SandboxError({ message: errorMessage(err), sandboxId }),
    });

    if (sandboxResult.isErr()) {
      throw sandboxResult.error;
    }
    const sandbox = sandboxResult.value;

    // Emit sandbox ID immediately so client can track it
    yield { type: "sandbox-id" as const, sandboxId: sandbox.sandboxId };

    // Setup new sandbox with agent-specific configuration
    if (!sandboxId) {
      try {
        for await (const progress of setupSandbox(sandbox, {
          agentId: agent.id,
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

    // Create proxy session for secure communication
    const proxySessionId = nanoid(32);
    await createSession(proxySessionId, { sandboxId: sandbox.sandboxId });

    const sandboxContext: SandboxContext = {
      sandboxId: sandbox.sandboxId,
      sandbox,
    };
    const proxyConfig: ProxyConfig = {
      sessionId: proxySessionId,
      baseUrl: PROXY_BASE_URL,
    };

    // Stream agent responses
    for await (const chunk of agent.execute({
      prompt,
      sandboxContext,
      sessionId,
      proxyConfig,
    })) {
      yield chunk;
    }

    // Emit preview URL when complete
    yield events.previewUrl(sandbox.domain(SANDBOX_DEV_PORT), SANDBOX_DEV_PORT);
  });
