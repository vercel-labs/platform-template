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
import type { SandboxContext } from "@/lib/agents/types";
import type { UIMessageChunk } from "ai";

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

    try {
      if (sandboxId) {
        console.log(`[chat] Getting existing sandbox: ${sandboxId}`);
        sandbox = await Sandbox.get({ sandboxId });
      } else {
        console.log("[chat] Creating new sandbox...");
        sandbox = await Sandbox.create({
          ports: [3000, 5173],
          timeout: 600_000,
        });
        console.log(`[chat] Sandbox created: ${sandbox.sandboxId}`);
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
