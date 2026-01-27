/**
 * Redis Client
 *
 * Upstash Redis client for session token management.
 */

import { Redis } from "@upstash/redis";

// Create Redis client using environment variables
// Upstash SDK automatically reads UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
// But we're using KV_REST_API_URL and KV_REST_API_TOKEN from Vercel KV
export const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

// Session data stored in Redis
export interface SessionData {
  createdAt: number;
  expiresAt: number;
  sandboxId?: string;
  /** User ID if session was created by an authenticated user */
  userId?: string;
}

// Session TTL in seconds (1 hour)
const SESSION_TTL = 60 * 60;

/**
 * Create a new session
 */
export async function createSession(
  sessionId: string,
  options?: { sandboxId?: string; userId?: string }
): Promise<SessionData> {
  const now = Date.now();
  const sessionData: SessionData = {
    createdAt: now,
    expiresAt: now + SESSION_TTL * 1000,
    sandboxId: options?.sandboxId,
    userId: options?.userId,
  };

  await redis.set(`session:${sessionId}`, JSON.stringify(sessionData), {
    ex: SESSION_TTL,
  });

  return sessionData;
}

/**
 * Get session data by session ID
 */
export async function getSession(
  sessionId: string
): Promise<SessionData | null> {
  const data = await redis.get(`session:${sessionId}`);
  if (!data) return null;

  try {
    // Upstash may return the data already parsed or as a string
    if (typeof data === "string") {
      return JSON.parse(data) as SessionData;
    }
    // Already an object
    return data as SessionData;
  } catch (error) {
    console.error("[redis] Failed to parse session data:", error);
    return null;
  }
}

/**
 * Delete a session
 */
export async function deleteSession(sessionId: string): Promise<void> {
  await redis.del(`session:${sessionId}`);
}

/**
 * Update session with sandbox ID
 */
export async function updateSessionSandbox(
  sessionId: string,
  sandboxId: string
): Promise<boolean> {
  const session = await getSession(sessionId);
  if (!session) return false;

  session.sandboxId = sandboxId;

  // Calculate remaining TTL
  const remainingTtl = Math.max(
    1,
    Math.floor((session.expiresAt - Date.now()) / 1000)
  );

  await redis.set(`session:${sessionId}`, JSON.stringify(session), {
    ex: remainingTtl,
  });

  return true;
}
