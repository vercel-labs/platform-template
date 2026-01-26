/**
 * Chat Procedure
 *
 * oRPC procedure for AI chat with agent streaming.
 */

import { os, ORPCError, streamToEventIterator, eventIterator } from "@orpc/server";
import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";
import { getAgent, isValidAgent, getDefaultAgent } from "@/lib/agents";
import { createAgentStream } from "@/lib/agents/stream";
import { sessionTokens } from "@/lib/store/session-tokens";
import type { SandboxContext } from "@/lib/agents/types";
import type { UIMessageChunk } from "ai";

/**
 * Generate a unique proxy session ID for sandbox API calls
 */
function generateProxySessionId(): string {
  return `proxy-${crypto.randomUUID()}`;
}

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

    // Generate proxy session ID (sync, instant)
    const proxySessionId = generateProxySessionId();
    const oidcToken = process.env.VERCEL_OIDC_TOKEN;
    if (oidcToken) {
      sessionTokens.set(proxySessionId, oidcToken);
    }

    // Determine the proxy base URL
    const host = process.env.VERCEL_URL || "localhost:3000";
    const protocol = process.env.VERCEL_URL ? "https" : "http";
    const proxyBaseUrl = `${protocol}://${host}/api/anthropic`;

    // Update sandbox context with proxy info
    sandboxContext.proxySessionId = proxySessionId;
    sandboxContext.proxyBaseUrl = proxyBaseUrl;

    // Yield sandbox ID first so client knows which sandbox we're using
    yield {
      type: "sandbox-id" as const,
      sandboxId: sandbox.sandboxId,
    };

    // Start dev server and wait for it to be ready before sending preview URL
    if (isNewSandbox && process.env.NEXTJS_SNAPSHOT_ID) {
      const previewUrl = sandbox.domain(3000);
      console.log(`[chat] Starting dev server, will wait for: ${previewUrl}`);

      // Start dev server (fire and forget)
      sandbox.runCommand({
        cmd: "npm",
        args: ["run", "dev"],
        cwd: "/vercel/sandbox",
        detached: true,
      }).catch((error) => {
        console.error("[chat] Failed to start dev server:", error);
      });

      // Poll until server is ready (max 30 seconds)
      const maxWaitMs = 30_000;
      const pollIntervalMs = 500;
      const startTime = Date.now();
      let serverReady = false;

      while (Date.now() - startTime < maxWaitMs) {
        try {
          const response = await fetch(previewUrl, {
            method: "HEAD",
            signal: AbortSignal.timeout(2000),
          });
          // Server is responding (200 or 404 means Next.js is running)
          if (response.ok || response.status === 404) {
            serverReady = true;
            console.log(`[chat] Dev server ready in ${Date.now() - startTime}ms`);
            break;
          }
        } catch {
          // Server not ready yet, continue polling
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }

      if (serverReady) {
        yield {
          type: "data" as const,
          dataType: "preview-url" as const,
          data: { url: previewUrl, port: 3000 },
        };
        console.log(`[chat] Preview URL sent: ${previewUrl}`);
      } else {
        console.error("[chat] Dev server did not become ready in time");
      }
    } else if (!isNewSandbox) {
      // Existing sandbox - server should already be running
      try {
        const previewUrl = sandbox.domain(3000);
        yield {
          type: "data" as const,
          dataType: "preview-url" as const,
          data: { url: previewUrl, port: 3000 },
        };
        console.log(`[chat] Preview URL (existing sandbox): ${previewUrl}`);
      } catch (error) {
        console.error("[chat] Failed to get preview URL:", error);
      }
    }

    // Write .env file (fire and forget)
    const envContent = `# Anthropic API proxy configuration
ANTHROPIC_BASE_URL=${proxyBaseUrl}
ANTHROPIC_API_KEY=${proxySessionId}
ANTHROPIC_AUTH_TOKEN=${proxySessionId}
`;
    sandbox.writeFiles([
      { path: "/vercel/sandbox/.env", content: Buffer.from(envContent, "utf-8") },
    ]).catch((error) => {
      console.error("[chat] Failed to write .env file:", error);
    });

    // Execute agent and stream chunks
    // Pass sessionId if provided to resume conversation
    const agentOutput = agent.execute({
      prompt,
      sandboxContext,
      sessionId,
    });

    // Stream each chunk from the agent
    for await (const chunk of agentOutput) {
      yield chunk;
    }
  });
