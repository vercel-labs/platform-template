
import { os, ORPCError } from "@orpc/server";
import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";
import { nanoid } from "nanoid";
import { getAgent, isValidAgent, getDefaultAgent, SANDBOX_DEV_PORT, SANDBOX_BASE_PATH } from "@/lib/agents";
import { createSession } from "@/lib/redis";
import { DATA_PART_TYPES } from "@/lib/types";
import type { SandboxContext, ProxyConfig } from "@/lib/agents/types";

const PROXY_BASE_URL =
  process.env.PROXY_BASE_URL ||
  "https://platform-template.labs.vercel.dev/api/ai/proxy";

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

    let sandbox: Sandbox;
    let sandboxContext: SandboxContext;
    let isNewSandbox = false;

    try {
      if (sandboxId) {
        sandbox = await Sandbox.get({ sandboxId });
      } else {
        isNewSandbox = true;
        const snapshotId = process.env.NEXTJS_SNAPSHOT_ID;

        if (snapshotId) {
          sandbox = await Sandbox.create({
            source: { type: "snapshot", snapshotId },
            ports: [SANDBOX_DEV_PORT],
            timeout: 600_000,
            resources: { vcpus: 2 },
          });
        } else {
          sandbox = await Sandbox.create({
            ports: [SANDBOX_DEV_PORT],
            timeout: 600_000,
          });
        }
      }
      sandboxContext = { sandboxId: sandbox.sandboxId, sandbox };
    } catch (error) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: `Sandbox error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    yield {
      type: "sandbox-id" as const,
      sandboxId: sandbox.sandboxId,
    };

    if (isNewSandbox) {
      yield {
        type: "data" as const,
        dataType: DATA_PART_TYPES.SANDBOX_STATUS,
        data: { sandboxId: sandbox.sandboxId, status: "warming" },
      };
    }

    const proxySessionId = nanoid(32);
    await createSession(proxySessionId, { sandboxId: sandbox.sandboxId });
    const proxyConfig: ProxyConfig = {
      sessionId: proxySessionId,
      baseUrl: PROXY_BASE_URL,
    };

    let devServerStarted = false;
    if (isNewSandbox && process.env.NEXTJS_SNAPSHOT_ID) {
      sandbox
        .runCommand({
          cmd: "npm",
          args: ["run", "dev"],
          cwd: SANDBOX_BASE_PATH,
          detached: true,
        })
        .catch(() => {
        });
      devServerStarted = true;
    }

    const agentOutput = agent.execute({
      prompt,
      sandboxContext,
      sessionId,
      proxyConfig,
    });

    let firstChunkReceived = false;
    for await (const chunk of agentOutput) {
      if (!firstChunkReceived && isNewSandbox) {
        firstChunkReceived = true;
        yield {
          type: "data" as const,
          dataType: DATA_PART_TYPES.SANDBOX_STATUS,
          data: { sandboxId: sandbox.sandboxId, status: "ready" },
        };
      }
      yield chunk;
    }

    const previewUrl = sandbox.domain(SANDBOX_DEV_PORT);

    if (devServerStarted) {
      const maxWaitMs = 10_000;
      const pollIntervalMs = 250;
      const startTime = Date.now();

      while (Date.now() - startTime < maxWaitMs) {
        try {
          const response = await fetch(previewUrl, {
            method: "HEAD",
            signal: AbortSignal.timeout(2000),
          });
          if (response.ok || response.status === 404) {
            yield {
              type: "data" as const,
              dataType: DATA_PART_TYPES.PREVIEW_URL,
              data: { url: previewUrl, port: SANDBOX_DEV_PORT },
            };
            break;
          }
        } catch {
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    } else {
      yield {
        type: "data" as const,
        dataType: DATA_PART_TYPES.PREVIEW_URL,
        data: { url: previewUrl, port: SANDBOX_DEV_PORT },
      };
    }
  });
