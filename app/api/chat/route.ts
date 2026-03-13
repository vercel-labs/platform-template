import { type NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
} from "ai";
import { createResumableStreamContext } from "resumable-stream";
import { checkBotId } from "botid/server";
import type { ChatMessage } from "@/lib/types";
import { runChat, type ChatStreamResult } from "@/lib/chat";
import { getSandboxSession, saveSandboxSession } from "@/lib/chat-history";
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

  // Persist the user's messages immediately so that other tabs loading
  // this chat URL mid-stream can see the conversation history.
  const existingSession = await getSandboxSession(chatId);
  await saveSandboxSession(chatId, {
    ...existingSession,
    messages: messages as ChatMessage[],
  });

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
        activeStreamId: null,
      });
    },
    onError: (error) => {
      console.error("[chat] Stream error:", error);
      return errorMessage(error);
    },
  });

  return createUIMessageStreamResponse({
    stream,
    async consumeSseStream({ stream: sseStream }) {
      const streamId = generateId();
      const streamContext = createResumableStreamContext({ waitUntil: after });
      await streamContext.createNewResumableStream(streamId, () => sseStream);

      // Track the active stream so clients can reconnect after page reload
      await saveSandboxSession(chatId, {
        ...existingSession,
        messages: messages as ChatMessage[],
        activeStreamId: streamId,
      });
    },
  });
}
