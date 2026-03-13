/**
 * Chat History & Sandbox State Storage
 *
 * Persists chat messages and sandbox metadata to Redis keyed by chatId.
 * Uses AI SDK UIMessage format for message storage.
 */

import { Result } from "better-result";
import { redis } from "./redis";
import type { ChatMessage } from "./types";

export interface SandboxSessionData {
  messages: ChatMessage[];
  /** The sandbox ID associated with this conversation */
  sandboxId?: string;
  previewUrl?: string;
  projectId?: string;
  projectOwnership?: "partner" | "user";
  deploymentUrl?: string;
  /** Agent session ID (e.g. Claude --resume ID) for conversation continuity */
  agentSessionId?: string;
  /** Active resumable stream ID, null when stream is complete */
  activeStreamId?: string | null;
}

const SESSION_PREFIX = "chat-session:";

// Session data expires after 24 hours
const SESSION_TTL_SECONDS = 24 * 60 * 60;

/**
 * Save session data keyed by chatId (messages + metadata)
 */
export async function saveSandboxSession(
  chatId: string,
  data: SandboxSessionData,
): Promise<void> {
  await redis.set(
    `${SESSION_PREFIX}${chatId}`,
    JSON.stringify(data),
    { EX: SESSION_TTL_SECONDS },
  );
}

/**
 * Get session data by chatId
 */
export async function getSandboxSession(
  chatId: string,
): Promise<SandboxSessionData | null> {
  const data = await redis.get(`${SESSION_PREFIX}${chatId}`);
  if (!data) return null;

  const parseResult = Result.try({
    try: () => JSON.parse(data) as SandboxSessionData,
    catch: (err) =>
      err instanceof Error ? err.message : "Failed to parse session data",
  });

  if (parseResult.isErr()) {
    console.error("[session] Failed to parse session data:", parseResult.error);
    return null;
  }

  return parseResult.value;
}
