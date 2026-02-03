/**
 * Redis client and proxy session management.
 *
 * Proxy sessions are short-lived tokens used to authenticate
 * sandbox-to-API communication through the proxy endpoint.
 * Not to be confused with user auth sessions in lib/auth/session.ts.
 */

import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});
export interface ProxySessionData {
  createdAt: number;
  expiresAt: number;
  sandboxId?: string;
}

const PROXY_SESSION_TTL_SECONDS = 60 * 60; // 1 hour
export async function createProxySession(
  sessionId: string,
  options?: { sandboxId?: string },
): Promise<ProxySessionData> {
  const now = Date.now();
  const sessionData: ProxySessionData = {
    createdAt: now,
    expiresAt: now + PROXY_SESSION_TTL_SECONDS * 1000,
    sandboxId: options?.sandboxId,
  };

  await redis.set(`session:${sessionId}`, JSON.stringify(sessionData), {
    ex: PROXY_SESSION_TTL_SECONDS,
  });

  return sessionData;
}
export async function getProxySession(
  sessionId: string,
): Promise<ProxySessionData | null> {
  const data = await redis.get(`session:${sessionId}`);
  if (!data) return null;

  try {
    if (typeof data === "string") {
      return JSON.parse(data) as ProxySessionData;
    }
    return data as ProxySessionData;
  } catch (error) {
    console.error("[redis] Failed to parse session data:", error);
    return null;
  }
}
export async function deleteProxySession(sessionId: string): Promise<void> {
  await redis.del(`session:${sessionId}`);
}
export async function updateProxySessionSandbox(
  sessionId: string,
  sandboxId: string,
): Promise<boolean> {
  const session = await getProxySession(sessionId);
  if (!session) return false;

  session.sandboxId = sandboxId;

  const remainingTtl = Math.max(
    1,
    Math.floor((session.expiresAt - Date.now()) / 1000),
  );

  await redis.set(`session:${sessionId}`, JSON.stringify(session), {
    ex: remainingTtl,
  });

  return true;
}
