import { os, ORPCError } from "@orpc/server";
import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";
import { nanoid } from "nanoid";
import {
  getAgent,
  isValidAgent,
  getDefaultAgent,
  SANDBOX_DEV_PORT,
} from "@/lib/agents";
import { createSession } from "@/lib/redis";
import { DATA_PART_TYPES } from "@/lib/types";
import { setupSandbox, SetupProgress } from "@/lib/sandbox/setup";
import { tryCatch } from "@/lib/utils";
import type { SandboxContext, ProxyConfig } from "@/lib/agents/types";

const PROXY_BASE_URL =
  process.env.PROXY_BASE_URL ||
  "https://platform-template.labs.vercel.dev/api/ai/proxy";

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object") return JSON.stringify(error);
  return String(error);
}

function sandboxStatusEvent(sandboxId: string, progress: SetupProgress) {
  return {
    type: "data" as const,
    dataType: DATA_PART_TYPES.SANDBOX_STATUS,
    data: {
      sandboxId,
      status: progress.stage === "ready" ? "ready" : "creating",
      message: progress.message,
    },
  };
}

function sandboxErrorEvent(sandboxId: string, error: string) {
  return {
    type: "data" as const,
    dataType: DATA_PART_TYPES.SANDBOX_STATUS,
    data: { sandboxId, status: "error", error },
  };
}

export const sendMessage = os
  .input(
    z.object({
      prompt: z.string().min(1),
      agentId: z.string().optional(),
      sandboxId: z.string().optional(),
      sessionId: z.string().optional(),
    })
  )
  .handler(async function* ({ input }) {
    const { prompt, agentId, sandboxId, sessionId } = input;

    const agent = isValidAgent(agentId ?? "")
      ? getAgent(agentId!)
      : getDefaultAgent();

    // Get existing sandbox or create new one
    const { data: sandbox, error: sandboxError } = await tryCatch(
      sandboxId
        ? Sandbox.get({ sandboxId })
        : Sandbox.create({ ports: [SANDBOX_DEV_PORT], timeout: 600_000 })
    );

    if (sandboxError || !sandbox) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: `Sandbox error: ${toErrorMessage(sandboxError)}`,
      });
    }

    const isNewSandbox = !sandboxId;

    // Immediately yield sandbox ID so client can show preview
    yield { type: "sandbox-id" as const, sandboxId: sandbox.sandboxId };

    // Set up new sandboxes with Next.js + shadcn + agent CLI
    if (isNewSandbox) {
      try {
        for await (const progress of setupSandbox(sandbox, { agentId: agent.id })) {
          if (progress) yield sandboxStatusEvent(sandbox.sandboxId, progress);
        }
      } catch (error) {
        const message = toErrorMessage(error);
        console.error("[chat] Setup failed:", message);
        yield sandboxErrorEvent(sandbox.sandboxId, message);
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: `Sandbox setup failed: ${message}` });
      }
    }

    // Create proxy session for agent API calls
    const proxySessionId = nanoid(32);
    await createSession(proxySessionId, { sandboxId: sandbox.sandboxId });

    const sandboxContext: SandboxContext = { sandboxId: sandbox.sandboxId, sandbox };
    const proxyConfig: ProxyConfig = { sessionId: proxySessionId, baseUrl: PROXY_BASE_URL };

    // Stream agent output
    for await (const chunk of agent.execute({ prompt, sandboxContext, sessionId, proxyConfig })) {
      yield chunk;
    }

    // Yield preview URL at the end
    yield {
      type: "data" as const,
      dataType: DATA_PART_TYPES.PREVIEW_URL,
      data: { url: sandbox.domain(SANDBOX_DEV_PORT), port: SANDBOX_DEV_PORT },
    };
  });
