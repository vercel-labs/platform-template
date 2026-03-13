import { type NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";
import { checkBotId } from "botid/server";
import type { ChatMessage } from "@/lib/types";
import { runChat, type ChatStreamResult } from "@/lib/chat";
import { saveSandboxSession } from "@/lib/chat-history";
import { errorMessage } from "@/lib/errors";

const messageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  parts: z.array(
    z.object({ type: z.string() }).passthrough(),
  ),
}).passthrough();

const chatRequestSchema = z.object({
  messages: z.array(messageSchema),
  chatId: z.string().min(1),
  agentId: z.string().optional(),
  templateId: z.string().optional(),
  sessionId: z.string().optional(),
});

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const verification = await checkBotId();
  if (verification.isBot) {
    return new Response("Access denied", { status: 403 });
  }

  const parsed = chatRequestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { messages, chatId, agentId, templateId, sessionId } = parsed.data;

  // Extract the latest user message text
  const lastMessage = messages[messages.length - 1];
  const prompt = lastMessage
    ? lastMessage.parts
        .filter((p) => p.type === "text" && typeof (p as Record<string, unknown>).text === "string")
        .map((p) => (p as Record<string, unknown>).text as string)
        .join("\n")
    : "";

  if (!prompt) {
    return NextResponse.json({ error: "No message text" }, { status: 400 });
  }

  // Capture session metadata from the chat stream for persistence
  let streamResult: ChatStreamResult = {};

  const stream = createUIMessageStream({
    originalMessages: messages as ChatMessage[],
    execute: async ({ writer }) => {
      streamResult = await runChat(writer, {
        prompt,
        chatId,
        agentId,
        templateId,
        sessionId,
      });
    },
    onFinish: async ({ messages: finalMessages }) => {
      // Persist the final messages + session metadata to Redis.
      // existingSession is carried through streamResult to avoid a second Redis read.
      const existing = streamResult.existingSession;
      await saveSandboxSession(chatId, {
        messages: finalMessages as ChatMessage[],
        sandboxId: streamResult.sandboxId,
        previewUrl: streamResult.previewUrl,
        projectId: existing?.projectId,
        projectOwnership: existing?.projectOwnership,
        deploymentUrl: existing?.deploymentUrl,
        agentSessionId: streamResult.agentSessionId,
      });
    },
    onError: (error) => {
      console.error("[chat] Stream error:", error);
      return errorMessage(error);
    },
  });

  // Use after() to ensure the stream is fully consumed for persistence
  // even if the client disconnects
  const [browserStream, persistStream] = stream.tee();

  after(async () => {
    const reader = persistStream.getReader();
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  });

  return createUIMessageStreamResponse({ stream: browserStream });
}
