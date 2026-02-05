/**
 * Chat History & Sandbox State Storage
 *
 * Persists chat messages and sandbox metadata to Redis keyed by sandboxId.
 * Used to restore state after OAuth redirects.
 */

import { Result } from "better-result";
import { redis } from "./redis";

export type MessagePart =
  | { type: "text"; content: string }
  | {
      type: "tool";
      id: string;
      name: string;
      input: string;
      output?: string;
      isError?: boolean;
      state: "streaming" | "done";
    };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
}

export interface SandboxSessionData {
  messages: ChatMessage[];
  previewUrl?: string;
  projectId?: string;
  projectOwnership?: "partner" | "user";
  deploymentUrl?: string;
}

const SANDBOX_SESSION_PREFIX = "sandbox-session:";

// Session data expires after 24 hours
const SESSION_TTL_SECONDS = 24 * 60 * 60;

/**
 * Save sandbox session data (messages + metadata)
 */
export async function saveSandboxSession(
  sandboxId: string,
  data: SandboxSessionData,
): Promise<void> {
  await redis.set(
    `${SANDBOX_SESSION_PREFIX}${sandboxId}`,
    JSON.stringify(data),
    { ex: SESSION_TTL_SECONDS },
  );
}

/**
 * Get sandbox session data
 */
export async function getSandboxSession(
  sandboxId: string,
): Promise<SandboxSessionData | null> {
  const data = await redis.get(`${SANDBOX_SESSION_PREFIX}${sandboxId}`);
  if (!data) return null;

  if (typeof data !== "string") {
    return data as SandboxSessionData;
  }

  const parseResult = Result.try({
    try: () => JSON.parse(data) as SandboxSessionData,
    catch: (err) =>
      err instanceof Error ? err.message : "Failed to parse session data",
  });

  if (parseResult.isErr()) {
    console.error("[sandbox-session] Failed to parse session data:", parseResult.error);
    return null;
  }

  return parseResult.value;
}

/**
 * Save chat messages for a sandbox (convenience wrapper)
 */
export async function saveChatHistory(
  sandboxId: string,
  messages: ChatMessage[],
): Promise<void> {
  const existing = await getSandboxSession(sandboxId);
  await saveSandboxSession(sandboxId, {
    ...existing,
    messages,
  });
}

/**
 * Get chat messages for a sandbox (convenience wrapper)
 */
export async function getChatHistory(
  sandboxId: string,
): Promise<ChatMessage[]> {
  const session = await getSandboxSession(sandboxId);
  return session?.messages ?? [];
}

/**
 * Delete sandbox session
 */
export async function deleteSandboxSession(sandboxId: string): Promise<void> {
  await redis.del(`${SANDBOX_SESSION_PREFIX}${sandboxId}`);
}
