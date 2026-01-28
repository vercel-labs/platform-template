import { Redis } from "@upstash/redis";

export const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

export interface SessionData {
  createdAt: number;
  expiresAt: number;
  sandboxId?: string;
}

const SESSION_TTL = 60 * 60;

export async function createSession(
  sessionId: string,
  options?: { sandboxId?: string }
): Promise<SessionData> {
  const now = Date.now();
  const sessionData: SessionData = {
    createdAt: now,
    expiresAt: now + SESSION_TTL * 1000,
    sandboxId: options?.sandboxId,
  };

  await redis.set(`session:${sessionId}`, JSON.stringify(sessionData), {
    ex: SESSION_TTL,
  });

  return sessionData;
}

export async function getSession(
  sessionId: string
): Promise<SessionData | null> {
  const data = await redis.get(`session:${sessionId}`);
  if (!data) return null;

  try {
    if (typeof data === "string") {
      return JSON.parse(data) as SessionData;
    }
    return data as SessionData;
  } catch (error) {
    console.error("[redis] Failed to parse session data:", error);
    return null;
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  await redis.del(`session:${sessionId}`);
}

export async function updateSessionSandbox(
  sessionId: string,
  sandboxId: string
): Promise<boolean> {
  const session = await getSession(sessionId);
  if (!session) return false;

  session.sandboxId = sandboxId;

  const remainingTtl = Math.max(
    1,
    Math.floor((session.expiresAt - Date.now()) / 1000)
  );

  await redis.set(`session:${sessionId}`, JSON.stringify(session), {
    ex: remainingTtl,
  });

  return true;
}
