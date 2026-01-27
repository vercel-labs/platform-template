/**
 * Chat Procedure
 *
 * oRPC procedure for AI chat with agent streaming.
 */

import { os, ORPCError } from "@orpc/server";
import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";
import { getVercelOidcToken } from "@vercel/oidc";
import { nanoid } from "nanoid";
import { getAgent, isValidAgent, getDefaultAgent } from "@/lib/agents";
import { createSession } from "@/lib/redis";
import type { SandboxContext, ProxyConfig } from "@/lib/agents/types";

// The deployed URL for the proxy - sandboxes need to call this URL
// localhost won't work since sandboxes are on a different network
const PROXY_BASE_URL =
  process.env.PROXY_BASE_URL ||
  "https://platform-template.labs.vercel.dev/api/ai/proxy";

/**
 * Send a chat message and stream the response
 */
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

    // Get agent
    const agent = isValidAgent(agentId ?? "")
      ? getAgent(agentId!)
      : getDefaultAgent();

    // Get or create sandbox
    let sandbox: Sandbox;
    let sandboxContext: SandboxContext;
    let isNewSandbox = false;

    try {
      if (sandboxId) {
        console.log(`[chat] Getting existing sandbox: ${sandboxId}`);
        sandbox = await Sandbox.get({ sandboxId });
      } else {
        isNewSandbox = true;
        const snapshotId = process.env.NEXTJS_SNAPSHOT_ID;

        if (snapshotId) {
          // Create from snapshot - instant Next.js + Tailwind + dev server
          // Use 2 vCPUs (4GB RAM) for faster dev server startup
          console.log(`[chat] Creating sandbox from snapshot: ${snapshotId}`);
          sandbox = await Sandbox.create({
            source: { type: "snapshot", snapshotId },
            ports: [3000],
            timeout: 600_000,
            resources: { vcpus: 2 },
          });
          console.log(`[chat] Sandbox created from snapshot: ${sandbox.sandboxId}`);
        } else {
          // No snapshot - create empty sandbox (agent will set up project)
          console.log("[chat] Creating new empty sandbox...");
          sandbox = await Sandbox.create({
            ports: [3000],
            timeout: 600_000,
          });
          console.log(`[chat] Empty sandbox created: ${sandbox.sandboxId}`);
        }
      }
      sandboxContext = { sandboxId: sandbox.sandboxId, sandbox };
    } catch (error) {
      console.error("[chat] Sandbox error:", error);
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: `Sandbox error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    // Yield sandbox ID first so client knows which sandbox we're using
    yield {
      type: "sandbox-id" as const,
      sandboxId: sandbox.sandboxId,
    };

    // For new sandboxes, send "warming" status - the first I/O takes ~11s
    if (isNewSandbox) {
      yield {
        type: "data" as const,
        dataType: "sandbox-status" as const,
        data: { sandboxId: sandbox.sandboxId, status: "warming" },
      };
    }

    // Create a session for the proxy
    // This stores the OIDC token in Redis and returns a session ID
    // The sandbox uses the session ID in place of the OIDC token
    let proxyConfig: ProxyConfig | undefined;
    try {
      let oidcToken: string | undefined;
      try {
        oidcToken = await getVercelOidcToken();
      } catch {
        oidcToken = process.env.VERCEL_OIDC_TOKEN;
      }

      if (oidcToken) {
        const proxySessionId = nanoid(32);
        await createSession(proxySessionId, oidcToken, sandbox.sandboxId);
        proxyConfig = {
          sessionId: proxySessionId,
          baseUrl: PROXY_BASE_URL,
        };
        console.log(
          `[chat] Created proxy session: ${proxySessionId.substring(0, 8)}...`
        );
      }
    } catch (error) {
      // If session creation fails, we'll fall back to direct OIDC
      console.error("[chat] Failed to create proxy session:", error);
    }

    // Start dev server in background (don't wait for it yet)
    // We'll send the preview URL after the agent finishes its first response
    let devServerStarted = false;
    if (isNewSandbox && process.env.NEXTJS_SNAPSHOT_ID) {
      console.log(`[chat] Starting dev server in background...`);
      sandbox
        .runCommand({
          cmd: "npm",
          args: ["run", "dev"],
          cwd: "/vercel/sandbox",
          detached: true,
        })
        .catch((error) => {
          console.error("[chat] Failed to start dev server:", error);
        });
      devServerStarted = true;
    }

    // Execute agent and stream chunks
    // Pass sessionId if provided to resume conversation
    // Pass proxyConfig so the sandbox routes requests through our proxy
    const agentOutput = agent.execute({
      prompt,
      sandboxContext,
      sessionId,
      proxyConfig,
    });

    // Stream each chunk from the agent
    let firstChunkReceived = false;
    for await (const chunk of agentOutput) {
      // Once we get the first chunk, sandbox is warm - update status
      if (!firstChunkReceived && isNewSandbox) {
        firstChunkReceived = true;
        yield {
          type: "data" as const,
          dataType: "sandbox-status" as const,
          data: { sandboxId: sandbox.sandboxId, status: "ready" },
        };
      }
      yield chunk;
    }

    // After agent response completes, send preview URL if server is ready
    const previewUrl = sandbox.domain(3000);

    if (devServerStarted) {
      // Poll until server is ready (max 10 seconds - should be ready by now)
      console.log(`[chat] Agent finished, waiting for dev server: ${previewUrl}`);
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
            console.log(`[chat] Dev server ready, sending preview URL`);
            yield {
              type: "data" as const,
              dataType: "preview-url" as const,
              data: { url: previewUrl, port: 3000 },
            };
            break;
          }
        } catch {
          // Server not ready yet
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    } else {
      // Existing sandbox or no snapshot - send preview URL immediately
      console.log(`[chat] Sending preview URL for existing sandbox`);
      yield {
        type: "data" as const,
        dataType: "preview-url" as const,
        data: { url: previewUrl, port: 3000 },
      };
    }
  });
